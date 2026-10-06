import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { SMS_CONSENT_MODULE } from "../modules/sms-consent";
import type SmsConsentModuleService from "../modules/sms-consent/service";
import { MESSAGE_LOG_MODULE } from "../modules/message-log";
import type MessageLogModuleService from "../modules/message-log/service";
import { withStopFooter } from "../utils/sms";
import { buildCartRecoveryUrl } from "../utils/cartRecoveryLink";
import { normalizeNanpPhone } from "../utils/phoneNumber";
import { SETTINGS_MODULE } from "../modules/settings";
import { resolveJobWindowStart } from "../utils/jobActiveWindow";
import type SettingsModuleService from "../modules/settings/service";

const DEFAULT_THRESHOLD_MINUTES = 60;
const LOOKBACK_WINDOW_DAYS = 7;
const MAX_SEND_ATTEMPTS = 3;
const PAGE_SIZE = 100;
const PHONE_COOLDOWN_HOURS = 24;
const CART_ABANDONMENT_TEMPLATE = "cart-abandonment";
const CHECKED_AT_METADATA_KEY = "signalhouse_recovery_checked_at";
const ATTEMPTS_METADATA_KEY = "signalhouse_recovery_attempts";
const JOB_STATE_NAME = "cart-abandonment";

/**
 * Finds carts abandoned longer than the configured threshold and sends a recovery SMS, gated by
 * `cart_recovery` consent — same fail-closed gate as the order/shipment subscribers.
 *
 * **Disabled by default** (`SIGNALHOUSE_CART_ABANDONMENT_ENABLED` must be `"true"`), for two
 * compounding reasons — flipping this on is a decision to make once both are resolved, not a
 * default this job should assume for itself:
 * 1. This is the first consumer of the `cart_recovery` purpose, and `checkEligibility`/
 *    `checkEligibilityByPhone` don't yet enforce the accepted-source allow-list the reference
 *    implementation requires for cart_recovery (express-written consent only — see the JSDoc on
 *    those methods). Today nothing calls `grantConsent` for this purpose so the gap is inert, but
 *    that stops being true the moment a consent-capture path ships.
 * 2. **No quiet-hours gate.** `cart_recovery` is the one purpose the reference implementation
 *    treats as telemarketing-grade (TCPA restricts telemarketing sends to 8am-9pm local time —
 *    see the LEGAL REVIEW note on `consentEligibility.server.js`'s `PURPOSE_CONFIG.cart_recovery`),
 *    and its own recovery path defers rather than drops a send outside that window
 *    (`recovery.js`'s `isQuietHours` call, backed by a whole confidence-graded timezone
 *    resolver). This job has no equivalent — it sends at whatever time of day the cron fires,
 *    every 15 minutes, with no timezone signal at all. A coarse country/region-derived
 *    approximation was considered and deliberately not shipped: getting it subtly wrong (DST,
 *    multi-timezone countries, the US in particular) would read as "quiet hours are handled"
 *    while still sending at 3am for a meaningful fraction of recipients — worse than an honest,
 *    visible gap. This needs either a real timezone signal or its own scoped card, not a rushed
 *    approximation bolted onto this one.
 *
 * The STOP footer (`../utils/sms`'s `withStopFooter`, porting `app/utils/stopFooter.js`'s rule) IS
 * implemented — appended only when the body doesn't already mention STOP and this is the first
 * successfully-delivered SMS this phone number has ever received from the store. The same helper
 * is shared with `order-placed.ts`/`shipment-created.ts` deliberately: "a prior outbound exists"
 * only implies "the footer was already delivered" if every send site applies the identical rule.
 *
 * Sends are also capped at one delivered message per phone number per `PHONE_COOLDOWN_HOURS`
 * (24h), checked against Medusa's notification history (successfully-delivered rows only) on
 * *every* attempt, not just the first. That serves two purposes at once: the ordinary cross-cart
 * cooldown (several stale carts sharing a phone must not produce more than one delivered text per
 * 24h — an ordinary repeat shopper, or an attacker exploiting the guest path's caller-supplied
 * `shipping_address.phone`), and a same-cart retry guard — if a previous attempt actually reached
 * the provider successfully but this job's own bookkeeping failed afterward (see the idempotency
 * key comment below), the retry finds its own prior success in this same check and stops instead
 * of sending a genuine duplicate.
 *
 * No settings UI exists yet, so configuration comes from env vars rather than
 * plugin/provider options, which scheduled jobs don't receive the way providers do. The recovery
 * link itself is a placeholder `?cart_id=` query string — a real link builder is the cart-recovery link flow's
 * scope; when `SIGNALHOUSE_CART_RECOVERY_URL_BASE` isn't set, the message omits the link entirely
 * rather than sending a broken one.
 * @async
 * @param {MedusaContainer} container - The Medusa container.
 */
export default async function cartAbandonmentJob(container: MedusaContainer) {
	const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

	if (process.env.SIGNALHOUSE_CART_ABANDONMENT_ENABLED !== "true") {
		logger.info("signalhouse-sms: cart abandonment disabled (set SIGNALHOUSE_CART_ABANDONMENT_ENABLED=true to enable)");
		return;
	}

	const cartModuleService = container.resolve(Modules.CART);
	const customerModuleService = container.resolve(Modules.CUSTOMER);
	const notificationModuleService = container.resolve(Modules.NOTIFICATION);
	const consentService: SmsConsentModuleService = container.resolve(SMS_CONSENT_MODULE);
	const messageLogService: MessageLogModuleService = container.resolve(MESSAGE_LOG_MODULE);
	const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);

	// All bookkeeping writes (checked/attempts) go through raw SQL touching only `metadata`,
	// never through the module service's updateCarts — that auto-bumps `updated_at` on every
	// save, which would silently pull a cart back out of its own staleness window the moment it's
	// first touched, breaking the attempt-retry path in particular (verified: a real second run
	// stopped finding a cart it had only stamped an attempt count on, because it no longer looked
	// stale). The staleness signal has to stay something only real customer activity moves.
	async function mergeMetadata(cartId: string, patch: Record<string, unknown>) {
		await pgConnection.raw(`update cart set metadata = coalesce(metadata, '{}'::jsonb) || ?::jsonb where id = ?`, [
			JSON.stringify(patch),
			cartId,
		]);
	}

	const thresholdMinutes = Number(process.env.SIGNALHOUSE_CART_ABANDONMENT_THRESHOLD_MINUTES) || DEFAULT_THRESHOLD_MINUTES;
	// Validated once, up front — not inside the per-cart loop. `buildCartRecoveryUrl` throws on an
	// unparseable base (e.g. missing a scheme), and that loop's try/catch treats any throw as a
	// send failure: after MAX_SEND_ATTEMPTS, every cart in the batch gets permanently stamped
	// `checked_at` from a single config typo, with no way to recover them once the env var is
	// fixed. Failing here once, and falling back to "no link" exactly like an unset var, keeps a
	// misconfiguration from silently disqualifying the abandoned-cart backlog.
	let recoveryUrlBase = process.env.SIGNALHOUSE_CART_RECOVERY_URL_BASE;
	if (!recoveryUrlBase) {
		logger.info("signalhouse-sms: SIGNALHOUSE_CART_RECOVERY_URL_BASE not set — recovery SMS will omit a link");
	} else {
		try {
			new URL(recoveryUrlBase);
		} catch {
			logger.error(
				`signalhouse-sms: SIGNALHOUSE_CART_RECOVERY_URL_BASE ("${recoveryUrlBase}") is not a valid URL — recovery SMS will omit a link`,
			);
			recoveryUrlBase = undefined;
		}
	}

	const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);
	const lookbackStart = new Date(Date.now() - LOOKBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000);

	// Only carts that became abandoned after the job was switched on are eligible. Without this, the
	// first run after enabling (or re-enabling after a long off period) texts every qualifying cart
	// from the past 7 days at once, a burst from a number with no sending history.
	const settingsService: SettingsModuleService = container.resolve(SETTINGS_MODULE);
	let activeSince: Date;
	try {
		const tick = await settingsService.recordJobTick(JOB_STATE_NAME);
		activeSince = tick.activeSince;
		if (tick.restarted) {
			logger.info(`signalhouse-sms: cart abandonment active since ${activeSince.toISOString()}; carts last updated before then are skipped`);
		}
	} catch (error) {
		// Fail closed: without the start marker this run can't tell a backlog from new carts. The
		// usual cause is an upgrade that skipped `npx medusa db:migrate`.
		logger.error(`signalhouse-sms: cart abandonment skipped, could not record job state (run \`npx medusa db:migrate\` after upgrading): ${(error as Error).message}`);
		return;
	}
	const windowStart = resolveJobWindowStart(activeSince, lookbackStart, thresholdMinutes * 60 * 1000);

	// The "not yet processed" and recency-window predicates have to be pushed into the DB query
	// itself, not filtered in memory after a LIMIT — otherwise already-stamped (or permanently
	// non-actionable, e.g. no phone) carts pile up inside the page forever, since nothing removes
	// them from a plain `updated_at < threshold` match, and newly-abandoned recoverable carts stop
	// being selected once the page fills with dead rows. `metadata` has no typed filter for "key
	// absent," so this goes through the raw connection; module-service hydration follows for just
	// the matched ids.
	// An empty cart (checkout started, no line item added yet) is exactly as permanently
	// non-actionable as a no-phone cart — excluded here, in the SQL, rather than filtered after
	// hydration, so it never consumes a page slot in the first place. Filtering it out post-query
	// (as an earlier version of this job did) reproduces the same stuck-page failure this whole
	// query was rewritten to avoid: an unstamped, unfilterable row that resorts to the front of
	// every future page forever.
	// Adding or removing an item doesn't bump `cart.updated_at`, so recent line-item activity also
	// counts as "not abandoned" (a shopper was texted minutes after adding an item).
	const { rows } = await pgConnection.raw(
		`select id from cart
		 where completed_at is null and deleted_at is null
		   and updated_at < ? and updated_at > ?
		   and (metadata ->> ?) is null
		   and exists (select 1 from cart_line_item li where li.cart_id = cart.id and li.deleted_at is null)
		   and not exists (select 1 from cart_line_item li where li.cart_id = cart.id and (li.updated_at >= ? or li.deleted_at >= ?))
		 order by updated_at asc
		 limit ?`,
		[threshold.toISOString(), windowStart.toISOString(), CHECKED_AT_METADATA_KEY, threshold.toISOString(), threshold.toISOString(), PAGE_SIZE],
	);
	const cartIds: string[] = rows.map((r: { id: string }) => r.id);
	if (!cartIds.length) {
		return;
	}

	const candidates = await cartModuleService.listCarts({ id: cartIds } as any, { relations: ["items", "shipping_address"] });

	// Cart and Customer are separate modules — CartDTO carries only customer_id, not an
	// expandable `customer` relation — so customers with no shipping-address phone are batch
	// fetched once rather than looked up per cart.
	const customerIdsNeedingLookup = [
		...new Set(candidates.filter((c) => c.customer_id && !c.shipping_address?.phone).map((c) => c.customer_id as string)),
	];
	const customers = customerIdsNeedingLookup.length
		? await customerModuleService.listCustomers({ id: customerIdsNeedingLookup })
		: [];
	const phoneByCustomerId = new Map(customers.map((c) => [c.id, c.phone]));

	// At most one recovery SMS per phone number per run — several stale carts sharing a number
	// (the same shopper abandoning more than once, or shipping_address forged with someone else's
	// number, since this is caller-supplied checkout input) must not multiply into that many
	// separate texts. This alone only holds within one 15-minute run, so it's paired below with a
	// durable, cross-run cooldown against Medusa's own notification history — otherwise N distinct
	// carts sharing a phone still produce N sends, one per run, and an attacker can trigger repeat
	// merchant-billed sends to any number holding a cart_recovery grant just by creating guest
	// carts with it.
	//
	// Keyed on the normalized (bare 10-digit) form, not the raw string — `withStopFooter` already
	// learned this lesson (see its own JSDoc): checkout input for the same real number varies in
	// format ("(555) 123-4567" vs "+15551234567"), and an exact-string dedup silently stops working
	// the moment two carts represent it differently (fable audit finding, same class of bug).
	const seenPhones = new Set<string>();

	for (const cart of candidates) {
		const rawPhone = cart.shipping_address?.phone || (cart.customer_id ? phoneByCustomerId.get(cart.customer_id) : undefined);
		const metadata = (cart.metadata as Record<string, unknown> | null) ?? {};
		const attemptsSoFar = Number(metadata[ATTEMPTS_METADATA_KEY]) || 0;

		if (!rawPhone) {
			// No phone is permanent, not transient — stamp it now so it leaves the working set,
			// exactly like an ineligible cart, rather than re-matching the query forever.
			await mergeMetadata(cart.id, { [CHECKED_AT_METADATA_KEY]: new Date().toISOString() });
			continue;
		}

		// Normalized ONLY for the seenPhones/cooldown dedup keys below — never used as the `to` value
		// actually sent. `normalizeNanpPhone` returns the bare digits unchanged for anything already
		// 10 digits, including a non-NANP number that happens to have a 10-digit national number
		// (e.g. Denmark, Norway); using that stripped form as `to` would erase the `+`/country-code
		// signal `normalizeForSignalHouseSend` needs to avoid mis-treating it as a US number
		// (ai-review finding, PR #1326). `rawPhone` — with its original formatting, `+` included when
		// present — is what actually flows to consent checks, the footer, and the send below.
		//
		// An unnormalizable phone falls through as its own raw value (can't be deduped against a
		// normalized one, so no seenPhones/cooldown collapsing for it specifically) rather than being
		// dropped outright — the actual safety net is downstream: checkEligibility/checkEligibilityByPhone
		// (`sms-consent/service.ts`) treat a phone they can't normalize as `no_consent_record` and
		// refuse to send, so this cart still can't produce an unconsented SMS either way.
		const dedupeKey = normalizeNanpPhone(rawPhone) ?? rawPhone;
		if (seenPhones.has(dedupeKey)) {
			await mergeMetadata(cart.id, { [CHECKED_AT_METADATA_KEY]: new Date().toISOString() });
			continue;
		}
		seenPhones.add(dedupeKey);

		// Runs on EVERY attempt, not just the first — a same-cart retry needs this exactly as much
		// as a fresh cart does (see the function-level JSDoc). Scoped to this specific template so
		// an unrelated SMS to the same number (an order confirmation, say) doesn't block a
		// legitimate recovery text, and to `status = 'success'` via raw SQL (not
		// `notificationModuleService.listNotifications` — `status` isn't a filterable
		// `FilterableNotificationProps` field) so a prior FAILED attempt never poisons this check;
		// only a message that actually reached the recipient counts. Compares on the same
		// normalized (last-10-digits) form `withStopFooter` uses, not an exact string match against
		// `rawPhone` — a prior run may have stored this same number in a different raw format.
		const cooldownStart = new Date(Date.now() - PHONE_COOLDOWN_HOURS * 60 * 60 * 1000);
		const { rows: recentSuccess } = await pgConnection.raw(
			`select 1 from notification where right(regexp_replace("to", '\\D', '', 'g'), 10) = ? and channel = 'sms' and template = ? and status = 'success' and created_at > ? limit 1`,
			[dedupeKey, CART_ABANDONMENT_TEMPLATE, cooldownStart.toISOString()],
		);
		if (recentSuccess.length) {
			logger.info(
				`signalhouse-sms: cart ${cart.id} phone already has a delivered recovery SMS within ${PHONE_COOLDOWN_HOURS}h, skipping`,
			);
			await mergeMetadata(cart.id, { [CHECKED_AT_METADATA_KEY]: new Date().toISOString() });
			continue;
		}

		try {
			const eligibility = cart.customer_id
				? await consentService.checkEligibility(cart.customer_id, rawPhone, "cart_recovery")
				: await consentService.checkEligibilityByPhone(rawPhone, "cart_recovery");

			if (eligibility.eligible) {
				const link = recoveryUrlBase ? ` ${buildCartRecoveryUrl(recoveryUrlBase, cart.id)}` : "";
				const body = await withStopFooter(container, rawPhone, `You left something in your cart!${link}`);
				// Scoped by attempt number, not just cart id: Medusa's own createNotifications, on
				// finding an existing `failure`-status row under the same idempotency_key, generates a
				// fresh row id for the retry but excludes it from the insert (since the key already
				// exists) and then tries to update that never-inserted id — throwing "Notification
				// with id ... not found" (@medusajs/notification's notification-module-service.js).
				// A per-attempt key means each retry is a key Medusa has never seen, so it always
				// takes the normal insert path instead of the broken update-a-ghost-row one. This is
				// safe against duplicate delivered sends only because the recentSuccess check above
				// now runs on every attempt, not just the first — that's the actual duplicate guard.
				const notification = await notificationModuleService.createNotifications({
					to: rawPhone,
					channel: "sms",
					template: CART_ABANDONMENT_TEMPLATE,
					content: { text: body },
					idempotency_key: `cart-abandonment:${cart.id}:${attemptsSoFar}`,
				});
				if (notification?.external_id) {
					// Nested, and deliberately not left to the outer catch below: the SMS has already
					// been sent and billed at this point, so a logging failure must never be counted as
					// a send failure — the outer catch's attempt-counter exists for sends that didn't
					// go out, and this cart must not be retried (or exhaust MAX_SEND_ATTEMPTS) over a
					// database hiccup in a call that has nothing left to retry.
					try {
						await messageLogService.recordSent({
							externalId: notification.external_id,
							phoneNumber: rawPhone,
							customerId: cart.customer_id ?? null,
							purpose: "cart_recovery",
							cartId: cart.id,
						});
					} catch (err) {
						logger.error(`signalhouse-sms: cart ${cart.id} recovery sent but failed to log to message-log: ${err instanceof Error ? err.message : String(err)}`);
					}
				}
				logger.info(`signalhouse-sms: cart ${cart.id} recovery sent`);
			} else {
				logger.info(`signalhouse-sms: cart ${cart.id} not eligible (${eligibility.reason}), skipping`);
			}

			await mergeMetadata(cart.id, { [CHECKED_AT_METADATA_KEY]: new Date().toISOString() });
		} catch (err) {
			// One cart's send failure must not abort the batch — every other stale cart in this run
			// still needs to be checked. Not stamped as checked outright: retried up to
			// MAX_SEND_ATTEMPTS (many failures here are permanent — landline, opted out, moderation
			// blocked — not transient, so an uncapped retry would hammer the API on every run
			// forever for a send that will never succeed).
			const attempts = attemptsSoFar + 1;
			logger.error(
				`signalhouse-sms: cart ${cart.id} failed (attempt ${attempts}/${MAX_SEND_ATTEMPTS}): ${err instanceof Error ? err.message : String(err)}`,
			);
			if (attempts >= MAX_SEND_ATTEMPTS) {
				await mergeMetadata(cart.id, { [CHECKED_AT_METADATA_KEY]: new Date().toISOString(), [ATTEMPTS_METADATA_KEY]: attempts });
			} else {
				await mergeMetadata(cart.id, { [ATTEMPTS_METADATA_KEY]: attempts });
			}
		}
	}
}

export const config = {
	name: "signalhouse-cart-abandonment",
	schedule: "*/15 * * * *",
};
