import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { SETTINGS_MODULE } from "../../modules/settings";
import type SettingsModuleService from "../../modules/settings/service";

export type SetSmsCostPerSegmentStepInput = {
	centsPerSegment: number | null;
};

/**
 * Persists the merchant's per-segment SMS cost assumption. No compensation — same as
 * `save-brand-status.ts`, this is a plain settings write with nothing to roll back.
 * @param {SetSmsCostPerSegmentStepInput} input - The cost per segment, in cents (or null to clear).
 * @returns {Promise<StepResponse>} The updated `account_link` row.
 */
export const setSmsCostPerSegmentStep = createStep(
	"set-sms-cost-per-segment",
	async (input: SetSmsCostPerSegmentStepInput, { container }) => {
		const settingsService: SettingsModuleService = container.resolve(SETTINGS_MODULE);
		const accountLink = await settingsService.setSmsCostPerSegmentCents(input.centsPerSegment);
		return new StepResponse(accountLink);
	},
);
