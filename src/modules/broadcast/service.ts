import { MedusaService } from "@medusajs/framework/utils";
import Broadcast from "./models/broadcast";
import BroadcastRecipient from "./models/broadcast-recipient";

export type BroadcastStatus = "draft" | "scheduled" | "sending" | "sent";
export type BroadcastRecipientStatus = "pending" | "sending" | "sent" | "failed";

export type CreateBroadcastWithRecipientsInput = {
	messageBody: string;
	customerGroupId: string | null;
	scheduledAt: Date | null;
	recipients: { phoneNumber: string; customerId: string | null }[];
};

export type RecordRecipientOutcomeInput = {
	status: "sent" | "failed";
	failureReason?: string | null;
};

/**
 * Persistence only, no consent/customer-group/notification calls — same division of responsibility
 * as `message-log/service.ts` and `sms-consent/service.ts`. Audience resolution lives in
 * `workflows/steps/resolve-broadcast-audience.ts`; the actual send loop lives in
 * `jobs/broadcast-send.ts`. This service only ever reads and writes `broadcast`/
 * `broadcast_recipient` rows.
 */
class BroadcastModuleService extends MedusaService({
	Broadcast,
	BroadcastRecipient,
}) {
	/**
	 * Creates a broadcast and one `broadcast_recipient` row per already-resolved recipient.
	 *
	 * Created as `draft` first, then flipped to its real target status only after every recipient
	 * row has committed — `createBroadcasts` and `createBroadcastRecipients` are two independent
	 * MedusaService writes with no shared transaction, so a broadcast created directly as `sending`
	 * would be visible to `jobs/broadcast-send.ts` (which polls every minute) for the entire
	 * duration of the recipient bulk insert, before any recipient rows exist. That job selects on
	 * `status: "sending"`, finds zero pending/sending recipients (they haven't committed yet), and
	 * would otherwise finalize the broadcast as `sent`
	 * with nobody ever messaged. `draft` is a status `listDueBroadcasts` never selects, so the job
	 * cannot observe (or prematurely finalize) a broadcast still in the middle of this method.
	 *
	 * A recipient-insert failure deletes the broadcast rather than leaving a orphaned `draft` row
	 * behind — a half-created broadcast has no recipients to complete or retry with, and `draft`
	 * being inert to the job (not `sent_count === 0` and stuck `sending`) doesn't make it any less
	 * useless to leave sitting in the admin's broadcast list.
	 *
	 * The final status itself: a zero-recipient audience goes straight to `sent` (with `sent_at`
	 * stamped) — there is nothing for the job to drain, so leaving it `sending` would just wait for
	 * the next tick to discover that and close it out. Otherwise it's `scheduled` (a future
	 * `scheduledAt`) or `sending` (send as soon as the next job tick runs).
	 * @async
	 * @param {CreateBroadcastWithRecipientsInput} input - The message, optional audience scope,
	 *   optional schedule time, and the already-resolved recipient list.
	 * @returns {Promise<object>} The created `broadcast` row, at its final status.
	 */
	async createBroadcastWithRecipients(input: CreateBroadcastWithRecipientsInput) {
		const hasRecipients = input.recipients.length > 0;
		const isFutureSchedule = !!input.scheduledAt && input.scheduledAt.getTime() > Date.now();
		const finalStatus: BroadcastStatus = !hasRecipients ? "sent" : isFutureSchedule ? "scheduled" : "sending";

		const broadcast = await this.createBroadcasts({
			message_body: input.messageBody,
			status: "draft" as BroadcastStatus,
			customer_group_id: input.customerGroupId,
			scheduled_at: input.scheduledAt,
			sent_at: null,
			recipient_count: input.recipients.length,
			sent_count: 0,
			failed_count: 0,
		});

		if (hasRecipients) {
			try {
				await this.createBroadcastRecipients(
					input.recipients.map((recipient) => ({
						broadcast_id: broadcast.id,
						customer_id: recipient.customerId,
						phone_number: recipient.phoneNumber,
						status: "pending" as BroadcastRecipientStatus,
						attempts: 0,
						failure_reason: null,
					})),
				);
			} catch (err) {
				await this.deleteBroadcastWithRecipients(broadcast.id);
				throw err;
			}
		}

		const [finalized] = await this.updateBroadcasts([
			{
				id: broadcast.id,
				status: finalStatus,
				sent_at: finalStatus === "sent" ? new Date() : null,
			},
		]);
		return finalized;
	}

	/**
	 * Deletes a broadcast and every recipient row it created. Used only as `create-broadcast`
	 * step's compensation — a workflow failure after this step must leave no partial broadcast
	 * behind for the admin UI to show.
	 * @async
	 * @param {string} broadcastId - The broadcast to remove.
	 */
	async deleteBroadcastWithRecipients(broadcastId: string) {
		const recipients = await this.listBroadcastRecipients({ broadcast_id: broadcastId });
		if (recipients.length) {
			await this.deleteBroadcastRecipients(recipients.map((recipient) => recipient.id));
		}
		await this.deleteBroadcasts([broadcastId]);
	}

	/**
	 * Broadcasts `jobs/broadcast-send.ts` should drain on this tick: scheduled ones whose time has
	 * arrived, plus any still `sending` from an interrupted prior run.
	 * @async
	 * @param {Date} now - The current time.
	 * @returns {Promise<object[]>} The due broadcasts.
	 */
	async listDueBroadcasts(now: Date) {
		const scheduledDue = await this.listBroadcasts({ status: "scheduled", scheduled_at: { $lte: now } });
		const sending = await this.listBroadcasts({ status: "sending" });
		return [...scheduledDue, ...sending];
	}

	/**
	 * Flips newly-due scheduled broadcasts to `sending`, right before their first drain pass.
	 * @async
	 * @param {string[]} broadcastIds - The broadcasts to mark.
	 */
	async markSending(broadcastIds: string[]) {
		if (!broadcastIds.length) return;
		await this.updateBroadcasts(broadcastIds.map((id) => ({ id, status: "sending" as BroadcastStatus })));
	}

	/**
	 * Records one recipient's terminal send outcome (`sent`, or `failed` after either a
	 * non-retryable rejection or exhausting `MAX_SEND_ATTEMPTS` retries in the job).
	 * @async
	 * @param {string} recipientId - The `broadcast_recipient` row to update.
	 * @param {RecordRecipientOutcomeInput} outcome - The outcome to record.
	 * @returns {Promise<object>} The updated recipient row.
	 */
	async recordRecipientOutcome(recipientId: string, outcome: RecordRecipientOutcomeInput) {
		const [updated] = await this.updateBroadcastRecipients([
			{
				id: recipientId,
				status: outcome.status,
				failure_reason: outcome.status === "failed" ? (outcome.failureReason ?? null) : null,
			},
		]);
		return updated;
	}

	/**
	 * Reverts a claimed (`sending`) recipient back to `pending` after a send attempt that should be
	 * retried, recording the attempt count so the job can give up after `MAX_SEND_ATTEMPTS`.
	 * @async
	 * @param {string} recipientId - The `broadcast_recipient` row to update.
	 * @param {number} attempts - The new attempt count.
	 * @param {string} failureReason - This attempt's failure, for visibility while it's retried.
	 * @returns {Promise<object>} The updated recipient row.
	 */
	async recordRecipientRetry(recipientId: string, attempts: number, failureReason: string) {
		const [updated] = await this.updateBroadcastRecipients([
			{
				id: recipientId,
				status: "pending" as BroadcastRecipientStatus,
				attempts,
				failure_reason: failureReason,
			},
		]);
		return updated;
	}

}

export default BroadcastModuleService;
