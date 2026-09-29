import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { MedusaError } from "@medusajs/framework/utils";
import { decryptApiKey } from "../../utils/apiKeyEncryption";
import { buildSignalHouseClient, unwrapSignalHouseResponse } from "../../utils/signalHouseClient";

export type FetchBrandStatusStepInput = {
	accountLink: { api_key_ciphertext: string; brand_id: string | null };
};

type BrandRecord = { _id: string; brandId: string | null; status: string };

/**
 * Re-reads the linked brand's current status via `GET /brand?id=<_id>` (`sdk.brands.getBrands`) —
 * polling by `_id` is the SDK's own documented contract for a brand not yet carrier-assigned
 * (`Brands.js`'s `BrandLookupId` typedef). Backs the admin UI's manual "Refresh status" action; there
 * is no automatic/webhook-driven sync.
 * @param {FetchBrandStatusStepInput} input - The account link holding the brand to refresh.
 * @returns {Promise<StepResponse>} The brand's current `_id`, carrier `brandId` (nullable), and
 *   `status`.
 * @throws {MedusaError} - When no brand has been submitted yet, or none is found at Signal House.
 */
export const fetchBrandStatusStep = createStep("fetch-brand-status", async (input: FetchBrandStatusStepInput) => {
	if (!input.accountLink.brand_id) {
		throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Submit a brand for review before refreshing its status.");
	}

	const apiKey = decryptApiKey(input.accountLink.api_key_ciphertext);
	const client = buildSignalHouseClient(apiKey);

	const response = await client.brands.getBrands({ id: input.accountLink.brand_id });
	const brands = unwrapSignalHouseResponse<BrandRecord[]>(response, "Could not refresh that brand's status");
	const brand = brands?.[0];
	if (!brand) {
		throw new MedusaError(MedusaError.Types.NOT_FOUND, "That brand could not be found at Signal House.");
	}

	return new StepResponse({
		brandId: brand._id,
		brandCarrierId: brand.brandId ?? null,
		brandStatus: brand.status,
	});
});
