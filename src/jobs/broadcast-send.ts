import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { SMS_CONSENT_MODULE } from "../modules/sms-consent";
import type SmsConsentModuleService from "../modules/sms-consent/service";
import { MESSAGE_LOG_MODULE } from "../modules/message-log";
import type MessageLogModuleService from "../modules/message-log/service";
import { BROADCAST_MODULE } from "../modules/broadcast";
import type BroadcastModuleService from "../modules/broadcast/service";
import { withStopFooter } from "../utils/sms";

const BATCH_SIZE_PER_BROADCAST = 100;
// Recipients within one claimed batch are sent concurrently, up to this many in flight at once —
// the per-recipient work is 4+ sequential round trips (consent check, footer scan, provider HTTP
// call, message-log insert), so a purely serial loop caps one broadcast at roughly
// BATCH_SIZE_PER_BROADCAST sends per tick regardless of provider latency.
const SEND_CONCURRENCY = 10;
const MAX_SEND_ATTEMPTS = 3;
// A row claimed (`sending`) longer than this without resolving is assumed abandoned — the process
// that claimed it was recycled (deploy, OOM, crash) mid-batch — and is eligible to be reclaimed by
// a later tick. Comfortably longer than one batch's realistic send time at SEND_CONCURRENCY.
const STALE_CLAIM_MINUTES = 15;
const BROADCAST_TEMPLATE = "broadcast";

type ClaimedRecipient = {
	id: string;
	customer_id: string | null;
	phone_number: string;
	attempts: number;
};

/**
 * Drains due broadcasts (scheduled ones whose time has arrived, plus any still `sending` from an
 * interrupted prior run) in batches, sending each claimed recipient's SMS and logging it to
 * `message-log`.
 *
 * **Disabled by default** (`SIGNALHOUSE_MARKETING_BROADCAST_ENABLED` must be `"true"`), for the
 * same reason `jobs/cart-abandonment.ts` stays disabled by default: `marketing` is at least as
 * telemarketing-grade as `cart_recovery` under the reference implementation this plugin's consent
 * model is ported from (TCPA restricts telemarketing sends to 8am-9pm local time), and this job has
 * no quiet-hours gate — at `BATCH_SIZE_PER_BROADCAST` sends per minute, the send time for most of a
 * large audience is a property of the drain rate, not of when an admin clicked send. Flipping this
 * on is a decision to make once a real timezone signal exists, not this job's default.
 *
 * **Claims each batch atomically** before sending (`UPDATE ... WHERE id IN (SELECT ... FOR UPDATE
 * SKIP LOCKED) RETURNING *`), flipping rows to `sending` (and stamping `updated_at`) in the same
 * statement that reads them — `pending` rows, or `sending` ones claimed more than
 * `STALE_CLAIM_MINUTES` ago and never resolved (a prior tick's process was recycled mid-batch; see
 * `finalizeBroadcastIfComplete` below for why an abandoned `sending` row must be reclaimable, not
 * just left stuck). This plugin is published to npm and installed into merchants' own Medusa
 * instances — it cannot assume a single worker process or that one tick finishes before the next
 * fires — so `SKIP LOCKED` means an overlapping tick simply picks up whatever the first tick hasn't
 * claimed yet, instead of blocking on or duplicating it.
 *
 * **Reclaiming a stale `sending` row re-sends only if the earlier attempt never actually reached
 * the provider.** Before sending, every recipient is checked against `message-log`'s
 * `findBroadcastSend` — if a `message_log` row already exists for this exact broadcast + phone
 * number, the earlier attempt DID succeed and this call only re-records the recipient's own outcome
 * (its status write was the thing that never completed, not the send). This closes the gap a naive
 * reclaim would otherwise open: `createNotifications` succeeding, `message-log`'s `recordSent`
 * succeeding, and then this job's own `recordRecipientOutcome` call failing or the process dying
 * before it runs — without the guard, that row would stay `sending`, get reclaimed, and genuinely
 * resend (and re-bill) an SMS that already went out.
 *
 * Every recipient's consent is re-checked immediately before sending, not just trusted from when
 * the audience was resolved at broadcast-creation time — a broadcast can sit `scheduled` for days,
 * and a customer who revokes marketing consent in that window must never receive it just because
 * they were eligible when `resolve-broadcast-audience` first ran. A recipient that's no longer
 * eligible is marked `failed` with the eligibility reason immediately (not retried — a revoked grant
 * isn't a transient condition).
 *
 * A send that throws IS retried, up to `MAX_SEND_ATTEMPTS`, the same bounded-retry shape
 * `cart-abandonment.ts` uses for the same reason documented there: many failures are permanent
 * (opted out, landline, moderation-blocked) and an uncapped retry would hammer the provider forever,
 * but this plugin has no reliable way to distinguish those from a transient one from the generic
 * error `SignalHouseSmsNotificationService.send()` throws either way, so a small bounded retry is
 * the same accepted tradeoff, not a new one. Reverting to `pending` (rather than leaving `sending`)
 * after a retryable failure is what makes the row eligible for the very next tick's claim, not just
 * the stale-reclaim path.
 *
 * Broadcast-level `sent_count`/`failed_count` are updated with a relative SQL `+ ?` per batch, and
 * the broadcast is only flipped to `sent` by one atomic, conditional statement
 * (`finalizeBroadcastIfComplete`) — both for the same reason the recipient claim is atomic: a
 * read-modify-write of the counters, or an unconditional "no pending rows left" check that ignores
 * `sending` rows, would let two overlapping ticks silently drop each other's updates or close a
 * broadcast out from under recipients another tick still has claimed.
 * @async
 * @param {MedusaContainer} container - The Medusa container.
 */
export default async function broadcastSendJob(container: MedusaContainer) {
	const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

	if (process.env.SIGNALHOUSE_MARKETING_BROADCAST_ENABLED !== "true") {
		logger.info("signalhouse-sms: marketing broadcast sending disabled (set SIGNALHOUSE_MARKETING_BROADCAST_ENABLED=true to enable)");
		return;
	}

	const notificationModuleService = container.resolve(Modules.NOTIFICATION);
	const consentService: SmsConsentModuleService = container.resolve(SMS_CONSENT_MODULE);
	const messageLogService: MessageLogModuleService = container.resolve(MESSAGE_LOG_MODULE);
	const broadcastService: BroadcastModuleService = container.resolve(BROADCAST_MODULE);
	const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);

	/**
	 * Atomically marks a broadcast `sent` if — and only if — it's still `sending` and has no
	 * `pending`/`sending` recipients left. Both conditions are checked in the same statement so an
	 * overlapping tick can never close a broadcast a moment after another tick claims more of its
	 * recipients, or close it twice.
	 */
	async function finalizeBroadcastIfComplete(broadcastId: string) {
		await pgConnection.raw(
			`update broadcast
			 set status = 'sent', sent_at = now()
			 where id = ?
			   and status = 'sending'
			   and not exists (
			     select 1 from broadcast_recipient
			     where broadcast_id = ? and status in ('pending', 'sending') and deleted_at is null
			   )`,
			[broadcastId, broadcastId],
		);
	}

	const now = new Date();
	const due = await broadcastService.listDueBroadcasts(now);
	if (!due.length) {
		return;
	}

	const newlyDueIds = due.filter((broadcast) => broadcast.status === "scheduled").map((broadcast) => broadcast.id);
	await broadcastService.markSending(newlyDueIds);

	for (const broadcast of due) {
		const { rows: claimed } = await pgConnection.raw(
			`update broadcast_recipient
			 set status = 'sending', updated_at = now()
			 where id in (
			   select id from broadcast_recipient
			   where broadcast_id = ?
			     and deleted_at is null
			     and (
			       status = 'pending'
			       or (status = 'sending' and updated_at < now() - interval '${STALE_CLAIM_MINUTES} minutes')
			     )
			   order by created_at asc
			   limit ?
			   for update skip locked
			 )
			 returning id, customer_id, phone_number, attempts`,
			[broadcast.id, BATCH_SIZE_PER_BROADCAST],
		);

		if (!claimed.length) {
			// Nothing left to claim — either every recipient resolved on a prior pass, or this
			// broadcast never had any (shouldn't reach here, since a zero-recipient broadcast is
			// created already `sent`, but finalizing is harmless either way).
			await finalizeBroadcastIfComplete(broadcast.id);
			continue;
		}

		let sentDelta = 0;
		let failedDelta = 0;

		async function processRecipient(recipient: ClaimedRecipient) {
			try {
				// A row reclaimed from a stale `sending` state may have already been sent by whatever
				// process abandoned it — see the function-level JSDoc. Checking this first means a
				// genuinely fresh `pending` claim pays one cheap indexed lookup, and a reclaim never
				// resends.
				const alreadySent = await messageLogService.findBroadcastSend(broadcast.id, recipient.phone_number);
				if (alreadySent) {
					await broadcastService.recordRecipientOutcome(recipient.id, { status: "sent" });
					sentDelta += 1;
					return;
				}

				const eligibility = recipient.customer_id
					? await consentService.checkEligibility(recipient.customer_id, recipient.phone_number, "marketing")
					: await consentService.checkEligibilityByPhone(recipient.phone_number, "marketing");

				if (!eligibility.eligible) {
					await broadcastService.recordRecipientOutcome(recipient.id, { status: "failed", failureReason: eligibility.reason });
					failedDelta += 1;
					return;
				}

				const body = await withStopFooter(container, recipient.phone_number, broadcast.message_body);
				const notification = await notificationModuleService.createNotifications({
					to: recipient.phone_number,
					channel: "sms",
					template: BROADCAST_TEMPLATE,
					content: { text: body },
					// Scoped by attempt number, not just recipient id — same reason as
					// `cart-abandonment.ts`'s identical comment: Medusa's own `createNotifications`, on
					// finding an existing `failure`-status row under a REUSED idempotency key, generates
					// a fresh row id for the retry but excludes it from the insert (the key already
					// exists) and then tries to update that never-inserted id, throwing "Notification
					// with id ... not found." A per-attempt key means each retry is a key Medusa has
					// never seen, so it always takes the normal insert path.
					idempotency_key: `broadcast:${broadcast.id}:${recipient.id}:${recipient.attempts}`,
				});

				// The send has now happened and been billed — a failure anywhere below this point must
				// never re-enter the retry path above (which would resend), only log and still count
				// the outcome as sent. This mirrors `order-placed.ts`/`shipment-created.ts`'s identical
				// "already sent, a logging failure is not a send failure" reasoning, extended to cover
				// the recipient-status write too, not just the message-log one.
				if (notification?.external_id) {
					try {
						await messageLogService.recordSent({
							externalId: notification.external_id,
							phoneNumber: recipient.phone_number,
							customerId: recipient.customer_id,
							purpose: "marketing",
							broadcastId: broadcast.id,
						});
					} catch (err) {
						logger.error(
							`signalhouse-sms: broadcast ${broadcast.id} recipient ${recipient.id} sent but failed to log to message-log: ${err instanceof Error ? err.message : String(err)}`,
						);
					}
				}

				try {
					await broadcastService.recordRecipientOutcome(recipient.id, { status: "sent" });
				} catch (err) {
					logger.error(
						`signalhouse-sms: broadcast ${broadcast.id} recipient ${recipient.id} sent but failed to record its outcome (will self-heal via the message-log check on reclaim): ${err instanceof Error ? err.message : String(err)}`,
					);
				}
				sentDelta += 1;
			} catch (err) {
				const reason = err instanceof Error ? err.message : String(err);
				const attempts = recipient.attempts + 1;
				logger.error(`signalhouse-sms: broadcast ${broadcast.id} recipient ${recipient.id} failed (attempt ${attempts}/${MAX_SEND_ATTEMPTS}): ${reason}`);
				if (attempts >= MAX_SEND_ATTEMPTS) {
					await broadcastService.recordRecipientOutcome(recipient.id, { status: "failed", failureReason: reason });
					failedDelta += 1;
				} else {
					await broadcastService.recordRecipientRetry(recipient.id, attempts, reason);
				}
			}
		}

		for (let i = 0; i < claimed.length; i += SEND_CONCURRENCY) {
			const chunk = claimed.slice(i, i + SEND_CONCURRENCY) as ClaimedRecipient[];
			await Promise.all(chunk.map((recipient) => processRecipient(recipient)));
		}

		await pgConnection.raw(`update broadcast set sent_count = sent_count + ?, failed_count = failed_count + ? where id = ?`, [
			sentDelta,
			failedDelta,
			broadcast.id,
		]);
		await finalizeBroadcastIfComplete(broadcast.id);
	}
}

export const config = {
	name: "signalhouse-broadcast-send",
	schedule: "*/1 * * * *",
};
