import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { randomUUID } from "node:crypto";

export const JOIN_CONFIRMATION_TEMPLATE = "join-confirmation";
const JOIN_CONFIRMATION_TEXT = "You're subscribed to text updates. Msg&data rates may apply. Reply STOP to opt out, HELP for help.";
const CLAIM_KEY_PREFIX = "join-confirmation:";
// Bounds the claim by age so a crash between the claim commit and the release below (a deploy or
// restart mid-send) self-heals instead of permanently blocking this one JOIN reply's confirmation
// with no in-product recovery (same class of gap fixed in create-brand.ts/
// grant-join-consent.ts, fixed here too for consistency).
const CLAIM_TTL_MINUTES = 5;

export type SendJoinConfirmationStepInput = {
	phoneNumber: string;
	/** The inbound message's own id (`metaData.Message._id`, mirrored at the webhook payload's
	 * top-level `identifier` by the Signal House webhook sender), stable across a
	 * retried webhook delivery of the same logical event. */
	identifier: string;
};

/**
 * Sends the mandatory CTIA welcome/confirmation SMS after a JOIN opt-in. Always carries the
 * STOP/HELP disclosure inline — this is the one always-on message, not the conditional
 * `withStopFooter` rule (a welcome message confirms this specific opt-in event, so it isn't
 * skipped based on prior-outbound history the way a marketing send's footer would be).
 *
 * Signal House's webhook sender retries the same delivery on timeout/5xx (a hard 3s timeout,
 * `webhook.service.js`'s `WEBHOOK_RETRY_OPTIONS`, first retry landing ~3.5s in) reusing the *same*
 * stable `identifier` across attempts. Exceeding 3s is ordinary here, not exotic — the workflow
 * this step is part of does several eligibility lookups plus a real outbound HTTPS call before this
 * step even runs. An earlier version of this guard checked for an existing *successful* send
 * before sending — which by construction cannot exist yet on a retry that arrives while the first
 * attempt is still in flight, so every such retry sent its own duplicate confirmation. Fixed the
 * same way `../../api/store/sms-consent/join-prompt/route.ts` fixes the identical race for phone
 * numbers: claim the `identifier` atomically (`pg_advisory_xact_lock` keyed on a hash of it, around
 * a short database-only check-and-insert against `sms_consent_send_claim`) *before* attempting the
 * send, not after it succeeds. A retry that arrives while the claim is held — regardless of
 * whether the original send has resolved yet — sees the claim and skips. If the send itself fails,
 * the claim is released so a genuinely failed confirmation can still be retried by a later,
 * legitimate webhook redelivery (this path isn't freely attacker-repeatable the way an HTTP route
 * is — a real inbound SMS reply is the only way to reach it — so unlike the join-prompt route, no
 * bounded-attempts convergence-to-hold is needed here).
 *
 * The actual `createNotifications` call still uses a random-suffixed `idempotency_key` (not a
 * fixed one) as defense in depth: `@medusajs/notification`'s `createNotifications` crashes
 * ("Notification with id ... not found") when a repeated `idempotency_key` matches an existing
 * `status: 'failure'` row — it generates a fresh row id for the "retry" but excludes it from the
 * insert (since the key already exists), then tries to update that never-inserted id. The same bug
 * is fixed in `jobs/cart-abandonment.ts`.
 * @param {SendJoinConfirmationStepInput} input - The phone number and the inbound message id.
 * @returns {Promise<StepResponse>} The created notification, or `null` if this exact JOIN reply's
 *   confirmation was already claimed by another (possibly still in-flight) delivery attempt.
 */
export const sendJoinConfirmationStep = createStep("send-join-confirmation", async (input: SendJoinConfirmationStepInput, { container }) => {
	const notificationModuleService = container.resolve(Modules.NOTIFICATION);
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
		return new StepResponse(null);
	}

	try {
		const notification = await notificationModuleService.createNotifications({
			to: input.phoneNumber,
			channel: "sms",
			template: JOIN_CONFIRMATION_TEMPLATE,
			content: {
				text: JOIN_CONFIRMATION_TEXT,
			},
			idempotency_key: `${claimKey}:${randomUUID()}`,
		});

		return new StepResponse(notification);
	} catch (err) {
		await pgConnection.raw(`delete from sms_consent_send_claim where id = ?`, [claimId]);
		throw err;
	}
});
