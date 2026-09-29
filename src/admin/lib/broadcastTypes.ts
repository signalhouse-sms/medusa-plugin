export type BroadcastStatus = "draft" | "scheduled" | "sending" | "sent";

export type BroadcastRow = {
	id: string;
	messageBody: string;
	status: BroadcastStatus;
	customerGroupId: string | null;
	scheduledAt: string | null;
	sentAt: string | null;
	recipientCount: number;
	sentCount: number;
	failedCount: number;
};

/** Shared by the broadcasts list and detail pages so a new status value or badge color can't
 * silently diverge between the two views. */
export const STATUS_BADGE_COLOR: Record<BroadcastStatus, "green" | "blue" | "orange" | "grey"> = {
	draft: "grey",
	scheduled: "orange",
	sending: "blue",
	sent: "green",
};
