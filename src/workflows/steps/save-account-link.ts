import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { SETTINGS_MODULE } from "../../modules/settings";
import type SettingsModuleService from "../../modules/settings/service";
import { encryptApiKey, last4 } from "../../utils/apiKeyEncryption";

export type SaveAccountLinkStepInput = {
	apiKey: string;
	groupId: string;
	subgroupId: string;
};

/**
 * Encrypts the verified API key and persists this install's account link. The plaintext key never
 * reaches storage — only `encryptApiKey`'s ciphertext and `last4` (for the admin UI to display
 * "connected as ...1234" without decrypting).
 * @param {SaveAccountLinkStepInput} input - The verified key and the group/subgroup it resolved to.
 * @returns {Promise<StepResponse>} The saved `account_link` row.
 */
export const saveAccountLinkStep = createStep("save-account-link", async (input: SaveAccountLinkStepInput, { container }) => {
	const settingsService: SettingsModuleService = container.resolve(SETTINGS_MODULE);

	const accountLink = await settingsService.saveAccountLink({
		apiKeyCiphertext: encryptApiKey(input.apiKey),
		apiKeyLast4: last4(input.apiKey),
		groupId: input.groupId,
		subgroupId: input.subgroupId,
	});

	return new StepResponse(accountLink);
});
