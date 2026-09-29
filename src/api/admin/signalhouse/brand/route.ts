import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { submitBrandWorkflow } from "../../../../workflows/submit-brand";
import type { BrandFormInput } from "../../../../workflows/submit-brand";
import { toAccountLinkResponse } from "../../../../utils/accountLinkResponse";
import { digitsOnly } from "../../../../utils/brandPayload";
import { withBillingStatus, withBroadcastSendingEnabled } from "../settings/route";

const REQUIRED_FIELDS: (keyof BrandFormInput)[] = [
	"legalCompanyName", "entityType", "country", "ein", "street", "city", "state",
	"postalCode", "firstName", "lastName", "email", "phone", "vertical",
];

/**
 * Submits a 10DLC brand for the linked Signal House account. Backs the admin settings screen's
 * "Submit for review" action.
 * @async
 * @param {MedusaRequest} req - The request. Body: the brand form fields (see `BrandFormInput`).
 * @param {MedusaResponse} res - The response.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
	const body = req.body as Partial<BrandFormInput>;
	const missing = REQUIRED_FIELDS.filter((field) => !body[field]);
	if (missing.length > 0) {
		res.status(400).json({ message: `missing required field(s): ${missing.join(", ")}` });
		return;
	}
	if (body.entityType !== "PRIVATE_PROFIT" && body.entityType !== "NON_PROFIT") {
		res.status(400).json({ message: "entityType must be PRIVATE_PROFIT or NON_PROFIT" });
		return;
	}
	if (digitsOnly(body.ein!).length !== 9) {
		res.status(400).json({ message: "ein must be 9 digits" });
		return;
	}
	if (digitsOnly(body.phone!).length !== 10) {
		res.status(400).json({ message: "phone must be a 10-digit US phone number" });
		return;
	}

	try {
		const { result } = await submitBrandWorkflow(req.scope).run({ input: body as BrandFormInput });
		const response = await withBillingStatus(withBroadcastSendingEnabled(toAccountLinkResponse(result.accountLink)), result.accountLink);
		res.status(200).json(response);
	} catch (err) {
		res.status(400).json({ message: err instanceof Error ? err.message : "Could not submit that brand." });
	}
}
