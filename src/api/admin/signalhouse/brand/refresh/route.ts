import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { refreshBrandStatusWorkflow } from "../../../../../workflows/refresh-brand-status";
import { toAccountLinkResponse } from "../../../../../utils/accountLinkResponse";
import { withBillingStatus, withBroadcastSendingEnabled } from "../../settings/route";

/**
 * Re-reads the linked brand's current status from Signal House. Backs the admin settings screen's
 * manual "Refresh status" action — there is no automatic polling.
 * @async
 * @param {MedusaRequest} req - The request. No body.
 * @param {MedusaResponse} res - The response.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
	try {
		const { result } = await refreshBrandStatusWorkflow(req.scope).run();
		const response = await withBillingStatus(withBroadcastSendingEnabled(toAccountLinkResponse(result.accountLink)), result.accountLink);
		res.status(200).json(response);
	} catch (err) {
		res.status(400).json({ message: err instanceof Error ? err.message : "Could not refresh that brand's status." });
	}
}
