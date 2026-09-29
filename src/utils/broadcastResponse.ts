export type BroadcastRow = {
	id: string;
	message_body: string;
	status: string;
	customer_group_id: string | null;
	scheduled_at: Date | string | null;
	sent_at: Date | string | null;
	recipient_count: number;
	sent_count: number;
	failed_count: number;
};

/**
 * Maps a `broadcast` row to the shape the admin UI is allowed to see. Shared by every admin route
 * that returns a broadcast (`broadcasts` create/list, `broadcasts/:id` get) so the response shape
 * is defined in exactly one place, same pattern as `accountLinkResponse.ts`.
 * @param {BroadcastRow} broadcast - The row to map.
 * @returns {object} The response body.
 */
export function toBroadcastResponse(broadcast: BroadcastRow) {
	return {
		id: broadcast.id,
		messageBody: broadcast.message_body,
		status: broadcast.status,
		customerGroupId: broadcast.customer_group_id,
		scheduledAt: broadcast.scheduled_at,
		sentAt: broadcast.sent_at,
		recipientCount: broadcast.recipient_count,
		sentCount: broadcast.sent_count,
		failedCount: broadcast.failed_count,
	};
}
