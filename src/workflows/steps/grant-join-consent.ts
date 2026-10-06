import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { SMS_CONSENT_MODULE } from "../../modules/sms-consent";
import type SmsConsentModuleService from "../../modules/sms-consent/service";
import type { ConsentPurpose } from "../../modules/sms-consent/service";

export const JOIN_GRANT_PURPOSES: ConsentPurpose[] = ["marketing", "cart_recovery", "ai_reply", "transactional"];
export const JOIN_SOURCE = "keyword_optin";
export const JOIN_CONSENT_VERSION = "v1-keyword-join";
const CLAIM_KEY_PREFIX = "join-consent:";
// Bounds the claim by age so a process crash between the claim commit and the release below (a
// deploy or restart mid-request) self-heals instead of permanently blocking this one JOIN reply's
// consent grant with no in-product recovery (same class already fixed
// in create-brand.ts). Per-identifier, not a global lock, so this can be generous without risking a
// legitimate concurrent grant for a DIFFERENT inbound message.
const CLAIM_TTL_MINUTES = 5;

export type GrantJoinConsentStepInput = {
	phoneNumber: string;
	/** The inbound message's own id — same value `sendJoinConfirmationStep` claims on, see below. */
	identifier: string;
	/** The verbatim inbound SMS body that carried the JOIN keyword (`message.messageBody` off the
	 * webhook payload, unnormalized). Recorded as `consentText` -- see the note in the
	 * JSDoc below for why this, and not any of our own outbound copy, is the correct artifact. */
	inboundMessageBody: string;
};

/**
 * Grants `marketing`/`cart_recovery`/`ai_reply`/`transactional` consent for a phone number that
 * sent a verified JOIN keyword. Includes `transactional` deliberately — the checkout checkbox this
 * flow backs is worded "Text me order updates," and `order-placed.ts`/`shipment-created.ts` gate
 * on `checkEligibility(..., "transactional")`, so omitting it here would mean that checkbox can
 * never actually deliver what it promises. A carrier-confirmed JOIN reply is at least as strong a
 * signal as anything else this module already accepts for transactional. Otherwise matches the
 * purpose set the Signal House Shopify app grants on JOIN.
 *
 * Claimed on `input.identifier` first, the same `pg_advisory_xact_lock` + `sms_consent_send_claim`
 * technique `sendJoinConfirmationStep` uses (a different key prefix, same table) — **not** just for
 * the harmless-duplicate-row reason that comment used to give, but because a *sequential* retry can
 * land after a genuine, intervening STOP: Signal House retries the same webhook delivery on
 * timeout/5xx (`webhook.service.js`'s `WEBHOOK_RETRY_OPTIONS`, ~3.5s to first retry), and if the
 * recipient texts STOP inside that window, the retried JOIN's own `checkEligibilityByPhone` sees
 * the now-revoked latest record as "not eligible" — indistinguishable from "never granted" — and
 * re-grants every purpose, silently reversing the STOP (found by audit; `revoke-consent-by-phone.ts`
 * calls this the one direction that must stick). Claiming the identifier makes a retry of the SAME
 * inbound message a full no-op regardless of what happened to consent state in between, rather than
 * re-running the eligibility check at all. Two genuinely CONCURRENT deliveries (not sequential) can
 * still race on the claim itself, but the loser simply skips — it can no longer reach the grant
 * logic to duplicate or resurrect anything.
 *
 * Deliberately no compensation function. `join-opt-in.ts`'s workflow orchestrator compensates
 * every already-succeeded step by default when a LATER step fails — and `sendJoinConfirmationStep`
 * runs after this one. A transient failure to send the confirmation text (a real, tested scenario:
 * verified end-to-end that without this, a simulated confirmation-send failure silently deleted an
 * already-granted, carrier-confirmed opt-in) must never retroactively erase a real consent event
 * the customer already gave via an actual SMS reply. The grant and the confirmation are
 * independent facts; only the confirmation is allowed to fail without consequence.
 *
 * `consentText` records the verbatim inbound JOIN reply, not any outbound copy of ours. The consent-text column exists to capture the language the recipient
 * agreed to; the JOIN *prompt* SMS is the closest candidate but is sent by a separate, unconnected
 * route (`send-join-prompt.ts` / the storefront join-prompt endpoint) that this workflow has no
 * guarantee ran before a given JOIN reply (an "unsolicited" JOIN advertised outside our system is
 * common), and the *confirmation* SMS is sent AFTER the grant and can fail or no-op independently
 * (see `sendJoinConfirmationStep`'s own claim/no-compensation logic) — either would risk asserting
 * language the recipient never actually saw. The one fact always true of every call here is the
 * inbound message itself: a carrier-confirmed SMS containing a JOIN-family keyword.
 * @param {GrantJoinConsentStepInput} input - The phone number, inbound message id, and inbound body.
 * @returns {Promise<StepResponse>} The consent records created (excluding any purpose that already
 *   had an active grant, which is skipped rather than duplicated), or `[]` if this exact JOIN
 *   reply was already claimed by another (possibly still in-flight) delivery attempt.
 */
export const grantJoinConsentStep = createStep("grant-join-consent", async (input: GrantJoinConsentStepInput, { container }) => {
	const consentService: SmsConsentModuleService = container.resolve(SMS_CONSENT_MODULE);
	const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
	const claimKey = `${CLAIM_KEY_PREFIX}${input.identifier}`;
	const claimId = `claim_${claimKey}`;

	let alreadyClaimed = false;
	await pgConnection.transaction(async (trx: any) => {
		await trx.raw(`select pg_advisory_xact_lock(hashtext(?))`, [claimKey]);
		const cooldownStart = new Date(Date.now() - CLAIM_TTL_MINUTES * 60 * 1000);
		const { rows } = await trx.raw(`select 1 from sms_consent_send_claim where claim_key = ? and created_at > ? limit 1`, [claimKey, cooldownStart.toISOString()]);
		if (rows.length) {
			alreadyClaimed = true;
			return;
		}
		// A stale claim (older than the TTL, from a crashed prior attempt) may still exist as a row —
		// upsert rather than a plain insert so it doesn't collide on the primary key.
		await trx.raw(
			`insert into sms_consent_send_claim (id, claim_key, created_at) values (?, ?, now())
			 on conflict (id) do update set created_at = now()`,
			[claimId, claimKey],
		);
	});

	if (alreadyClaimed) {
		return new StepResponse([]);
	}

	try {
		const records = await Promise.all(
			JOIN_GRANT_PURPOSES.map(async (purpose) => {
				const existing = await consentService.checkEligibilityByPhone(input.phoneNumber, purpose);
				if (existing.eligible) {
					return null;
				}
				return consentService.grantConsent(null, input.phoneNumber, purpose, {
					source: JOIN_SOURCE,
					consentVersion: JOIN_CONSENT_VERSION,
					consentText: `Inbound SMS: "${input.inboundMessageBody}"`,
				});
			}),
		);

		return new StepResponse(records.filter((record) => record !== null));
	} catch (err) {
		// A genuinely failed grant (e.g. a transient DB error, not a STOP race) must remain
		// retryable by a later, legitimate redelivery — same reasoning as
		// `sendJoinConfirmationStep`'s release-on-failure.
		await pgConnection.raw(`delete from sms_consent_send_claim where id = ?`, [claimId]);
		throw err;
	}
});
