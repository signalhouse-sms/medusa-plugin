import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { createBroadcastWorkflow } from "../../../../workflows/create-broadcast";
import { BROADCAST_MODULE } from "../../../../modules/broadcast";
import type BroadcastModuleService from "../../../../modules/broadcast/service";
import { toBroadcastResponse } from "../../../../utils/broadcastResponse";

// A hard ceiling against an unbounded body, not a real SMS-segmentation limit — Signal House/
// Infobip compute the actual segment count (and cost) on send, this just rejects something no
// legitimate broadcast message would ever need to be.
const MAX_MESSAGE_BODY_LENGTH = 1600;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

type CreateBroadcastBody = {
	messageBody?: string;
	customerGroupId?: string | null;
	scheduledAt?: string | null;
};

/**
 * Creates a broadcast: resolves the marketing-consented audience (optionally scoped to a customer
 * group) and records one `broadcast_recipient` row per recipient, either for immediate sending or
 * a future scheduled time. The actual sends happen in `jobs/broadcast-send.ts`, not here.
 * @async
 * @param {MedusaRequest} req - The request. Body: `messageBody` (required), `customerGroupId`
 *   (optional — omit for "every marketing-consented customer"), `scheduledAt` (optional ISO date
 *   string in the future — omit to send as soon as the next job tick runs).
 * @param {MedusaResponse} res - The response.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
	const body = req.body as CreateBroadcastBody;
	const messageBody = body.messageBody?.trim();

	if (!messageBody) {
		res.status(400).json({ message: "messageBody is required" });
		return;
	}
	if (messageBody.length > MAX_MESSAGE_BODY_LENGTH) {
		res.status(400).json({ message: `messageBody must be at most ${MAX_MESSAGE_BODY_LENGTH} characters` });
		return;
	}

	let scheduledAt: Date | null = null;
	if (body.scheduledAt) {
		scheduledAt = new Date(body.scheduledAt);
		if (Number.isNaN(scheduledAt.getTime())) {
			res.status(400).json({ message: "scheduledAt must be a valid date" });
			return;
		}
		if (scheduledAt.getTime() <= Date.now()) {
			res.status(400).json({ message: "scheduledAt must be in the future" });
			return;
		}
	}

	try {
		const { result } = await createBroadcastWorkflow(req.scope).run({
			input: { messageBody, customerGroupId: body.customerGroupId ?? null, scheduledAt },
		});
		res.status(200).json(toBroadcastResponse(result));
	} catch (err) {
		res.status(400).json({ message: err instanceof Error ? err.message : "Could not create that broadcast." });
	}
}

/**
 * Lists broadcasts, most recently created first.
 * @async
 * @param {MedusaRequest} req - The request. Query: `limit` (default 20, max 100), `offset`
 *   (default 0).
 * @param {MedusaResponse} res - The response.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
	const query = req.query as { limit?: string; offset?: string };
	const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
	const offset = Math.max(Number(query.offset) || 0, 0);

	const broadcastService: BroadcastModuleService = req.scope.resolve(BROADCAST_MODULE);
	const [broadcasts, count] = await broadcastService.listAndCountBroadcasts(
		{},
		{ take: limit, skip: offset, order: { created_at: "DESC" } },
	);

	res.status(200).json({ broadcasts: broadcasts.map(toBroadcastResponse), count, limit, offset });
}
