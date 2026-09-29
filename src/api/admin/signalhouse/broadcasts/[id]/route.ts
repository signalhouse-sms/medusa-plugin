import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { BROADCAST_MODULE } from "../../../../../modules/broadcast";
import type BroadcastModuleService from "../../../../../modules/broadcast/service";
import { toBroadcastResponse } from "../../../../../utils/broadcastResponse";

/**
 * Returns one broadcast by id.
 * @async
 * @param {MedusaRequest} req - The request. Params: `id`.
 * @param {MedusaResponse} res - The response.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
	const broadcastService: BroadcastModuleService = req.scope.resolve(BROADCAST_MODULE);
	const [broadcast] = await broadcastService.listBroadcasts({ id: req.params.id }, { take: 1 });

	if (!broadcast) {
		res.status(404).json({ message: "Broadcast not found" });
		return;
	}

	res.status(200).json(toBroadcastResponse(broadcast));
}
