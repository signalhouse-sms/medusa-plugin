import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { sendJoinPromptWorkflow } from "../../../../workflows/send-join-prompt";
import { normalizeNanpPhone } from "../../../../utils/phoneNumber";

const JOIN_PROMPT_COOLDOWN_MINUTES = 60;
// Bounded retries per number per cooldown window, not unlimited — mirrors `jobs/cart-abandonment.ts`'s
// MAX_SEND_ATTEMPTS. A prior version of this route deleted the reservation on ANY send failure,
// which an attacker could exploit by picking a phone number guaranteed to fail every send (a
// landline, a DNC-suppressed number, one that already replied STOP — all real, deterministic
// failure modes in `providers/signalhouse-sms/service.ts`) to loop this route indefinitely: every
// iteration takes a lock, writes, calls the real Signal House API, and cleans up, with nothing
// ever converging. After this many failures for the same number within the cooldown window, the
// claim is no longer released — a new request for that number is rejected until the window ends.
const MAX_JOIN_PROMPT_ATTEMPTS = 3;
// A generous ceiling, not a precise capacity plan — its job is to bound the cost/complaint blast
// radius of abuse (see the threat-model note below), not to model real traffic. Counts CLAIMS
// (attempts), not delivered notifications — a cap based on `status = 'success'` rows never
// engages against a number chosen specifically because sends to it always fail.
const STORE_HOURLY_PROMPT_CAP = 200;
const CLAIM_KEY_PREFIX = "join-prompt:";

class JoinPromptCooldownError extends Error {}

/**
 * Sends a "Reply JOIN to confirm" SMS to the phone number on file for a cart's shipping address.
 * Deliberately grants no consent itself — this route is reachable by any anonymous browser holding
 * the storefront's publishable key (public, client-embedded, not a real credential), so it can
 * only cause an SMS to be sent to a number, never mark one as consented. The actual grant only
 * happens in `../../../webhooks/signalhouse/route.ts`, gated behind a real, carrier-confirmed JOIN
 * reply from that number's own phone.
 *
 * **Honest threat model**: `cart_id` does NOT prove the caller owns the phone number that ends up
 * targeted — `shipping_address.phone` is free-text checkout input the same anonymous caller
 * controls, so an attacker can create a cart carrying a victim's number and then call this route
 * with that cart's real id (`cart-abandonment.ts` already treats this same field as untrusted for
 * the identical reason). What `cart_id` binding actually buys: the destination is server-resolved,
 * not a bare string typed into this route's own body, and every send traces back to a real, logged
 * cart creation. The genuine backstop is that this route can only cause an SMS to be sent, never
 * grant consent — without a real reply from the targeted number's own phone, that number never
 * becomes eligible for `cart_recovery`/marketing sends no matter how many prompts it receives. The
 * rate limits below bound the volume/cost exposure of unsolicited prompts themselves, which is the
 * actual residual risk.
 *
 * **Rate limiting, and why it's shaped this way** (this route's concurrency/failure-handling story
 * has been wrong twice before, per ai-review — documented so the next change doesn't repeat any of
 * these): one claim per (normalized) phone number per hour, reserved atomically via a
 * `pg_advisory_xact_lock` keyed on a hash of the *phone number* (not a single fixed key, so
 * different numbers never serialize against each other) around a short, database-only
 * transaction against `sms_consent_send_claim` (this card's own migration — deliberately not the
 * `notification` table, see the migration's own comment). The real send always runs *after* that
 * reservation transaction commits, never inside the lock — holding a lock and a pooled DB
 * connection across an outbound HTTPS round-trip would cap store-wide throughput at one send per
 * provider round-trip and risk starving the connection pool under concurrent load.
 *
 * The claim's `status` ('pending' while a send is in flight, then 'succeeded' or 'failed') is what
 * makes concurrent requests for the same number actually safe — tracking only a failure *count*
 * was tried and found broken by this card's own end-to-end verification: a second, concurrent
 * request saw the first request's freshly-inserted row with zero recorded failures yet and
 * concluded "nothing pending, safe to retry," sending a real duplicate. A 'pending' row now blocks
 * every other request for that number outright, the same as a 'succeeded' one; only a *settled*
 * 'failed' row — outcome already known — is eligible to be handed back out for another attempt,
 * and only while under `MAX_JOIN_PROMPT_ATTEMPTS`. Past that, the number stays held for the rest of
 * the cooldown window regardless of how many more requests arrive. The store-wide cap is
 * deliberately *not* lock-guarded (a little overshoot under a genuine burst is a far better outcome
 * than serializing every request store-wide on one global lock) and counts claims via a bounded
 * existence probe, not `count(*)`, so it stays cheap at any table size.
 * @async
 * @param {MedusaRequest} req - The request. Body: `{ cart_id: string }`.
 * @param {MedusaResponse} res - The response.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
	const body = req.body as { cart_id?: string };
	const cartId = body.cart_id;
	if (!cartId || typeof cartId !== "string") {
		res.status(400).json({ message: "cart_id is required" });
		return;
	}

	const cartModuleService = req.scope.resolve(Modules.CART);
	const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
	const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

	let cart;
	try {
		cart = await cartModuleService.retrieveCart(cartId, { relations: ["shipping_address"] });
	} catch {
		res.status(404).json({ message: "cart not found" });
		return;
	}

	const normalizedPhone = cart.shipping_address?.phone ? normalizeNanpPhone(cart.shipping_address.phone) : null;
	if (!normalizedPhone) {
		res.status(400).json({ message: "cart has no valid phone number on file" });
		return;
	}

	// A number whose latest consent row is revoked has texted STOP. Don't prompt it again from a
	// checkout form anyone can fill in with that number; the owner can still text JOIN to opt back in.
	// The reply is the same as the cooldown's, so a caller can't use this route to learn who opted out.
	const { rows: latestConsent } = await pgConnection.raw(
		`select revoked_at from consent_record where phone_number = ? and deleted_at is null order by granted_at desc limit 1`,
		[normalizedPhone],
	);
	if (latestConsent[0]?.revoked_at) {
		logger.info(`signalhouse-sms: join-prompt suppressed for ${normalizedPhone}, number has opted out`);
		res.status(429).json({ message: "a join prompt was already sent to this number recently" });
		return;
	}

	const claimKey = `${CLAIM_KEY_PREFIX}${normalizedPhone}`;
	const cooldownStart = new Date(Date.now() - JOIN_PROMPT_COOLDOWN_MINUTES * 60 * 1000);

	// Checked BEFORE the per-number claim is reserved, deliberately: reserving a claim commits a
	// 'pending' row, and 'pending' blocks every future request for that number the same as a
	// 'succeeded' one (see below) — so a request rejected here must never have written one, or the
	// number would be locked out for the rest of the cooldown window despite no send ever having
	// been attempted (a real bug, found by ai-review, when this check ran after the reservation).
	const hourStart = new Date(Date.now() - 60 * 60 * 1000);
	const { rows: overCap } = await pgConnection.raw(
		`select 1 from sms_consent_send_claim where claim_key like ? and created_at > ? order by created_at desc offset ? limit 1`,
		[`${CLAIM_KEY_PREFIX}%`, hourStart.toISOString(), STORE_HOURLY_PROMPT_CAP - 1],
	);
	if (overCap.length) {
		logger.error(`signalhouse-sms: join-prompt store-wide hourly cap (${STORE_HOURLY_PROMPT_CAP}) reached, rejecting`);
		res.status(429).json({ message: "too many join prompts sent recently, try again later" });
		return;
	}

	let claimId: string;
	try {
		claimId = await pgConnection.transaction(async (trx: any) => {
			// Keyed per phone number (hashtext, not a fixed global key), so different numbers never
			// serialize against each other — only concurrent requests for the SAME number queue here.
			await trx.raw(`select pg_advisory_xact_lock(hashtext(?))`, [claimKey]);

			const { rows: existing } = await trx.raw(
				`select id, status, failed_attempts from sms_consent_send_claim where claim_key = ? and created_at > ? order by created_at desc limit 1`,
				[claimKey, cooldownStart.toISOString()],
			);
			const row = existing[0];
			if (row) {
				// A 'pending' row means an attempt is in flight right now (outcome unknown) and a
				// 'succeeded' row means one already landed this window — both block a new request
				// exactly the same way. Only a *settled* 'failed' row, under the attempt cap, is
				// eligible to be handed back out for another try.
				if (row.status !== "failed") {
					throw new JoinPromptCooldownError();
				}
				if (Number(row.failed_attempts) >= MAX_JOIN_PROMPT_ATTEMPTS) {
					throw new JoinPromptCooldownError();
				}
				await trx.raw(`update sms_consent_send_claim set status = 'pending' where id = ?`, [row.id]);
				return row.id as string;
			}

			const id = `claim_${claimKey}_${Date.now()}`;
			await trx.raw(`insert into sms_consent_send_claim (id, claim_key, status, created_at) values (?, ?, 'pending', now())`, [id, claimKey]);
			return id;
		});
	} catch (err) {
		if (err instanceof JoinPromptCooldownError) {
			res.status(429).json({ message: "a join prompt was already sent to this number recently" });
			return;
		}
		throw err;
	}

	try {
		await sendJoinPromptWorkflow(req.scope).run({ input: { phoneNumber: normalizedPhone } });
	} catch (err) {
		await pgConnection.raw(
			`update sms_consent_send_claim set status = 'failed', failed_attempts = failed_attempts + 1 where id = ?`,
			[claimId],
		);
		logger.error(`signalhouse-sms: join-prompt send to ${normalizedPhone} failed: ${err instanceof Error ? err.message : String(err)}`);
		res.status(502).json({ message: "failed to send confirmation prompt" });
		return;
	}

	await pgConnection.raw(`update sms_consent_send_claim set status = 'succeeded' where id = ?`, [claimId]);
	res.status(200).json({ sent: true });
}
