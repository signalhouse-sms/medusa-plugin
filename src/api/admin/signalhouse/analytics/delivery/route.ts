import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MESSAGE_LOG_MODULE } from "../../../../../modules/message-log";
import type MessageLogModuleService from "../../../../../modules/message-log/service";
import type { MessagePurpose } from "../../../../../modules/message-log/service";

const VALID_PURPOSES: MessagePurpose[] = ["marketing", "cart_recovery", "ai_reply", "transactional"];
const DEFAULT_WINDOW_DAYS = 90;

/**
 * Returns delivery-rate analytics for messages this plugin has sent, optionally filtered by purpose
 * and/or a start date. `since` defaults to the last 90 days, not all-time — `message_log` is
 * append-only with no retention/pruning, and this route has no way to know it's talking to a store
 * with a small history; an unbounded default would mean every call counts the entire table.
 * @async
 * @param {MedusaRequest} req - The request. Query: `purpose` (one of `VALID_PURPOSES`, optional),
 *   `since` (ISO date string, optional — defaults to 90 days ago).
 * @param {MedusaResponse} res - The response.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
	const query = req.query as { purpose?: string; since?: string };

	if (query.purpose && !VALID_PURPOSES.includes(query.purpose as MessagePurpose)) {
		res.status(400).json({ message: `purpose must be one of: ${VALID_PURPOSES.join(", ")}` });
		return;
	}

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
	const summary = await messageLogService.getDeliverySummary({
		purpose: query.purpose as MessagePurpose | undefined,
		since,
	});

	res.status(200).json(summary);
}
