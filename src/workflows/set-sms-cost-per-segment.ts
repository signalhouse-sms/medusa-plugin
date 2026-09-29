import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { setSmsCostPerSegmentStep, type SetSmsCostPerSegmentStepInput } from "./steps/set-sms-cost-per-segment";

/**
 * Sets the merchant's per-segment SMS cost assumption, backing the admin settings screen's ROI
 * pricing field. See `SettingsModuleService.setSmsCostPerSegmentCents`'s own JSDoc for why this
 * exists as a stand-in ahead of real billing.
 * @param {SetSmsCostPerSegmentStepInput} input - The cost per segment, in cents (or null to clear).
 * @returns {WorkflowResponse} The updated account link.
 */
export const setSmsCostPerSegmentWorkflow = createWorkflow(
	"set-sms-cost-per-segment",
	(input: SetSmsCostPerSegmentStepInput) => {
		const accountLink = setSmsCostPerSegmentStep(input);
		return new WorkflowResponse({ accountLink });
	},
);
