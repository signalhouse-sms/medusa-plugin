import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { SETTINGS_MODULE } from "../../modules/settings";
import type SettingsModuleService from "../../modules/settings/service";

export type SaveBrandStatusStepInput = {
	brandId: string;
	brandCarrierId: string | null;
	brandStatus: string;
};

/**
 * Persists brand state onto this install's account link. Shared by `submit-brand` (first write) and
 * `refresh-brand-status` (subsequent status refreshes) — both produce the same shape.
 * @param {SaveBrandStatusStepInput} input - The brand state to persist.
 * @returns {Promise<StepResponse>} The updated `account_link` row.
 */
export const saveBrandStatusStep = createStep("save-brand-status", async (input: SaveBrandStatusStepInput, { container }) => {
	const settingsService: SettingsModuleService = container.resolve(SETTINGS_MODULE);

	const accountLink = await settingsService.saveBrandStatus(input);

	return new StepResponse(accountLink);
});
