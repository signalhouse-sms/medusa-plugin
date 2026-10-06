import { MedusaService } from "@medusajs/framework/utils";
import MessageLog from "./models/message-log";

export type MessagePurpose = "marketing" | "cart_recovery" | "ai_reply" | "transactional";
export type MessageStatus = "sent" | "delivered" | "failed";

export type RecordSentInput = {
	externalId: string;
	phoneNumber: string;
	customerId?: string | null;
	purpose: MessagePurpose;
	cartId?: string | null;
	broadcastId?: string | null;
};

export type RecordDeliveryInput = {
	externalId: string;
	status: "delivered" | "failed";
	segmentCount?: number | null;
	failureReason?: string | null;
};

export type DeliverySummaryFilter = {
	purpose?: MessagePurpose;
	since?: Date;
};

export type DeliverySummary = {
	sent: number;
	delivered: number;
	failed: number;
	pending: number;
	/** `delivered / (delivered + failed)` — resolved messages only, so a burst of very recent sends
	 * still awaiting a carrier callback doesn't understate the rate. `null` when nothing has resolved
	 * yet (avoids a misleading 0%, which would read as "everything failed" rather than "no data"). */
	deliveryRate: number | null;
};

export type AttributionSummaryFilter = {
	since?: Date;
};

export type CartSaveRateSummary = {
	sent: number;
	converted: number;
	/** `converted / sent`. `null` when no `cart_recovery` message has been sent in the window, not a
	 * misleading 0%. */
	cartSaveRate: number | null;
};

/**
 * Persistence only, no Signal House SDK/webhook-verification calls — same division of responsibility
 * as `sms-consent/service.ts` and `settings/service.ts`. `recordSent` is called by every send site
 * right after `notificationModuleService.createNotifications` succeeds
 * (`subscribers/order-placed.ts`, `shipment-created.ts`, `jobs/cart-abandonment.ts`); `recordDelivery`
 * is called by the DLR webhook handler (`api/webhooks/signalhouse/route.ts`).
 */
class MessageLogModuleService extends MedusaService({
	MessageLog,
}) {
	/**
	 * Logs a message this plugin just sent. Called immediately after the send succeeds — not from a
	 * separate step — which closes the gap of a *step boundary* landing between the
	 * external call and its persistence (see `create-brand.ts`'s own JSDoc for that history). It does
	 * NOT make the pair atomic: `createNotifications` and this call are still two independent awaited
	 * writes, so a transient failure of this call alone (after a real, already-sent SMS) leaves a
	 * permanent gap in this table. Every call site wraps this in its own try/catch precisely because
	 * that failure must never be mistaken for — or block — the send it's merely trying to log.
	 * @async
	 * @param {RecordSentInput} input - The sent message's identity and purpose.
	 * @returns {Promise<object>} The created `message_log` row.
	 */
	async recordSent(input: RecordSentInput) {
		return this.createMessageLogs({
			external_id: input.externalId,
			phone_number: input.phoneNumber,
			customer_id: input.customerId ?? null,
			purpose: input.purpose,
			cart_id: input.cartId ?? null,
			broadcast_id: input.broadcastId ?? null,
			segment_count: null,
			status: "sent",
			sent_at: new Date(),
			delivered_at: null,
			failed_at: null,
			failure_reason: null,
		});
	}

	/**
	 * Finds an already-logged send attempt to one phone number for one broadcast, if any — ANY
	 * status, not just `sent`/`delivered`. This is `jobs/broadcast-send.ts`'s recovery guard: a
	 * reclaimed/retried recipient checks this *before* actually sending, so a crash between a real
	 * provider send (already reaching Signal House and getting billed) and recording the recipient
	 * row's own outcome can never resend — and re-bill — the same broadcast message to the same
	 * number.
	 *
	 * `recordSent` is only ever called after a successful (non-throwing) `createNotifications`, so
	 * the EXISTENCE of any `message_log` row for this broadcast+phone is itself the proof the
	 * provider call happened — a row's later `status` describes carrier delivery, not whether the
	 * send occurred. Filtering to `sent`/`delivered` (an earlier version of this method did) misses
	 * exactly the case that most needs catching: a DLR webhook flips the row to `failed` sometime
	 * after the send, and a stale-reclaimed recipient would then find "no `sent`/`delivered` row"
	 * and genuinely resend a message that already went out and already failed on the carrier side
	 * — a `failed` `message_log` row is not evidence the send didn't
	 * happen, it's evidence it did and then didn't deliver.
	 * @async
	 * @param {string} broadcastId - The broadcast to check.
	 * @param {string} phoneNumber - The recipient phone number to check.
	 * @returns {Promise<object | null>} The existing `message_log` row, or null if none exists.
	 */
	async findBroadcastSend(broadcastId: string, phoneNumber: string) {
		const [existing] = await this.listMessageLogs(
			{ broadcast_id: broadcastId, phone_number: phoneNumber },
			{ take: 1 },
		);
		return existing ?? null;
	}

	/**
	 * Records a carrier delivery outcome against the message it belongs to, looked up by
	 * `external_id`. A no-op (returns null) when no matching row exists — a DLR for a message this
	 * plugin never logged (sent before this shipped, or from a code path this phase doesn't cover
	 * yet) rather than an error, since the webhook has no other action to take on it.
	 * @async
	 * @param {RecordDeliveryInput} input - The delivery outcome to record.
	 * @returns {Promise<object | null>} The updated `message_log` row, or null if not found.
	 */
	async recordDelivery(input: RecordDeliveryInput) {
		const [existing] = await this.listMessageLogs({ external_id: input.externalId }, { take: 1 });
		if (!existing) {
			return null;
		}

		const now = new Date();
		const [updated] = await this.updateMessageLogs([{
			id: existing.id,
			status: input.status,
			segment_count: input.segmentCount ?? existing.segment_count,
			delivered_at: input.status === "delivered" ? now : existing.delivered_at,
			failed_at: input.status === "failed" ? now : existing.failed_at,
			failure_reason: input.status === "failed" ? (input.failureReason ?? null) : existing.failure_reason,
		}]);
		return updated;
	}

	/**
	 * Summarizes send/delivery counts, optionally filtered by purpose and/or a start date.
	 * @async
	 * @param {DeliverySummaryFilter} [filter] - Optional purpose/date-range filter.
	 * @returns {Promise<DeliverySummary>} The counts and resolved-delivery rate.
	 */
	async getDeliverySummary(filter: DeliverySummaryFilter = {}): Promise<DeliverySummary> {
		const where: Record<string, unknown> = {};
		if (filter.purpose) where.purpose = filter.purpose;
		if (filter.since) where.sent_at = { $gte: filter.since };

		const [, sent] = await this.listAndCountMessageLogs(where, { take: 1 });
		const [, delivered] = await this.listAndCountMessageLogs({ ...where, status: "delivered" }, { take: 1 });
		const [, failed] = await this.listAndCountMessageLogs({ ...where, status: "failed" }, { take: 1 });
		const resolved = delivered + failed;

		return {
			sent,
			delivered,
			failed,
			pending: sent - resolved,
			deliveryRate: resolved > 0 ? delivered / resolved : null,
		};
	}

	/**
	 * Summarizes cart-recovery send-to-conversion counts. A row counts as converted once
	 * `subscribers/order-attribution.ts` has stamped its `converted_order_id` — this method only
	 * reads that state, it never sets it (the write is an atomic conditional UPDATE living in the
	 * subscriber itself, guarding against a double-credit race between two `order.placed` events;
	 * see that file's own JSDoc).
	 * @async
	 * @param {AttributionSummaryFilter} [filter] - Optional start-date filter.
	 * @returns {Promise<CartSaveRateSummary>} The send/convert counts and resulting rate.
	 */
	async getCartSaveRateSummary(filter: AttributionSummaryFilter = {}): Promise<CartSaveRateSummary> {
		const where: Record<string, unknown> = { purpose: "cart_recovery" };
		if (filter.since) where.sent_at = { $gte: filter.since };

		const [, sent] = await this.listAndCountMessageLogs(where, { take: 1 });
		const [, converted] = await this.listAndCountMessageLogs({ ...where, converted_order_id: { $ne: null } }, { take: 1 });

		return {
			sent,
			converted,
			cartSaveRate: sent > 0 ? converted / sent : null,
		};
	}

}

export default MessageLogModuleService;
