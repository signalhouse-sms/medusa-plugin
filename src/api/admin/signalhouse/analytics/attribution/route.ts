import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { MESSAGE_LOG_MODULE } from "../../../../../modules/message-log";
import type MessageLogModuleService from "../../../../../modules/message-log/service";
import { SETTINGS_MODULE } from "../../../../../modules/settings";
import type SettingsModuleService from "../../../../../modules/settings/service";

const DEFAULT_WINDOW_DAYS = 90;

/**
 * Returns cart-save-rate, revenue-attribution, and ROI analytics — the 3 panels
 * `analytics/delivery` doesn't cover. `since` defaults to the last 90 days,
 * same reasoning and default as `analytics/delivery`: `message_log` is append-only with no
 * retention/pruning, so an unbounded default would count the entire table on every call.
 *
 * Revenue attribution and ROI's cost basis are both computed by a single raw SQL aggregate over
 * `marketing` sends in the window, not a fetch-and-reduce in the app — converted rows scale with
 * total marketing volume (a roughly fixed conversion rate), not with how many conversions
 * happened, so "fetch every converted row" is not the bounded query an earlier version of this
 * route assumed it was (ai-review, PR #1321); `message_log` is sized for a 10M-msg/hr-scale store.
 * `segment_count` (the per-message cost-basis input) is only known once a DLR confirms it
 * (`recordDelivery`) — a send still awaiting that callback, or one whose DLR never arrives, falls
 * back to 1 (every sent SMS costs at least one segment), rather than being excluded or treated as
 * free. `converted_amount_cents` is summed as integer cents and converted to the display major
 * unit only at the end, matching the column's own precision rationale.
 *
 * ROI is omitted (not returned as 0 or null-masked-as-zero) when no `sms_cost_per_segment_cents` is
 * configured yet (`PUT /admin/signalhouse/settings`) or when the window has no marketing sends to
 * cost out — both are "not computable," not "zero return."
 * @async
 * @param {MedusaRequest} req - The request. Query: `since` (ISO date string, optional — defaults to
 *   90 days ago).
 * @param {MedusaResponse} res - The response.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
	const query = req.query as { since?: string };

	let since: Date;
	if (query.since) {
		since = new Date(query.since);
		if (Number.isNaN(since.getTime())) {
			res.status(400).json({ message: "since must be a valid date" });
			return;
		}
	} else {
		since = new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
	}

	const messageLogService: MessageLogModuleService = req.scope.resolve(MESSAGE_LOG_MODULE);
	const settingsService: SettingsModuleService = req.scope.resolve(SETTINGS_MODULE);
	const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);

	const [cartSaveRate, accountLink, { rows }] = await Promise.all([
		messageLogService.getCartSaveRateSummary({ since }),
		settingsService.getAccountLink(),
		pgConnection.raw(
			`select
			   count(*) as sent,
			   count(*) filter (where converted_order_id is not null) as converted,
			   coalesce(sum(converted_amount_cents) filter (where converted_order_id is not null), 0) as revenue_cents,
			   coalesce(sum(coalesce(segment_count, 1)), 0) as total_segments
			 from message_log
			 where purpose = 'marketing' and sent_at >= ? and deleted_at is null`,
			[since.toISOString()],
		),
	]);

	const row = rows[0] ?? { sent: 0, converted: 0, revenue_cents: 0, total_segments: 0 };
	const revenueAttribution = {
		sent: Number(row.sent),
		converted: Number(row.converted),
		revenueAttributed: Number(row.revenue_cents) / 100,
	};

	const costPerSegmentCents = accountLink?.sms_cost_per_segment_cents ?? null;
	let roi: number | null = null;
	if (costPerSegmentCents != null && revenueAttribution.sent > 0) {
		const totalSegments = Number(row.total_segments);
		const costDollars = (totalSegments * costPerSegmentCents) / 100;
		roi = costDollars > 0 ? revenueAttribution.revenueAttributed / costDollars : null;
	}

	res.status(200).json({ since, cartSaveRate, revenueAttribution, roi });
}
