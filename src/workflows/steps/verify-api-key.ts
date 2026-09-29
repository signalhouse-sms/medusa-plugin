import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { MedusaError } from "@medusajs/framework/utils";
import { buildSignalHouseClient, unwrapSignalHouseResponse } from "../../utils/signalHouseClient";

export type VerifyApiKeyStepInput = {
	apiKey: string;
};

/**
 * Verifies a merchant-pasted Signal House API key by calling `GET /auth/group-id`
 * (`sdk.auth.getGroupId`) — the same discovery call the SDK's own JSDoc calls out as the way to find
 * your own groupId. The SDK never rejects on a failed call — `unwrapSignalHouseResponse` is what
 * turns a `{ success: false }` (bad key, network error) into a thrown `MedusaError`, so a route
 * catching it can say "that API key isn't valid" instead of silently treating an invalid key as
 * verified.
 * @param {VerifyApiKeyStepInput} input - The API key to verify.
 * @returns {Promise<StepResponse>} The account's groupId.
 * @throws {MedusaError} - When the key doesn't verify.
 */
export const verifyApiKeyStep = createStep("verify-api-key", async (input: VerifyApiKeyStepInput) => {
	const client = buildSignalHouseClient(input.apiKey);

	const response = await client.auth.getGroupId();
	const data = unwrapSignalHouseResponse<{ groupId?: string }>(response, "That Signal House API key could not be verified");

	if (!data?.groupId) {
		throw new MedusaError(MedusaError.Types.INVALID_DATA, "That Signal House API key could not be verified.");
	}

	return new StepResponse({ groupId: data.groupId });
});
