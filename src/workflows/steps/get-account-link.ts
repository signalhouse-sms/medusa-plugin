import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { MedusaError } from "@medusajs/framework/utils";
import { SETTINGS_MODULE } from "../../modules/settings";
import type SettingsModuleService from "../../modules/settings/service";

/**
 * Reads this install's account link. Shared by `submit-brand` and `refresh-brand-status` — both
 * need the linked `subgroupId` and (still-encrypted) API key before they can call the Signal House
 * API on this account's behalf.
 * @returns {Promise<StepResponse>} The `account_link` row.
 * @throws {MedusaError} - When no account has been linked yet.
 */
export const getAccountLinkStep = createStep("get-account-link", async (_input: void, { container }) => {
	const settingsService: SettingsModuleService = container.resolve(SETTINGS_MODULE);

	const accountLink = await settingsService.getAccountLink();
	if (!accountLink) {
		throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Connect a Signal House account before continuing.");
	}

	return new StepResponse(accountLink);
});
