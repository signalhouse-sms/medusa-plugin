import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import type { WorkflowData } from "@medusajs/framework/workflows-sdk";
import { revokeConsentByPhoneStep } from "./steps/revoke-consent-by-phone";

export type StopOptOutWorkflowInput = {
	phoneNumber: string;
	revocationMethod: string;
};

/**
 * Runs on a verified inbound STOP keyword: revokes every active consent grant for the phone number.
 * @param {WorkflowData<StopOptOutWorkflowInput>} input - The phone number and revocation method.
 * @returns {WorkflowResponse} The consent records that were revoked.
 */
export const stopOptOutWorkflow = createWorkflow("stop-opt-out", (input: WorkflowData<StopOptOutWorkflowInput>) => {
	return new WorkflowResponse(revokeConsentByPhoneStep(input));
});
