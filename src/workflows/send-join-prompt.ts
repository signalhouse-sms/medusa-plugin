import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import type { WorkflowData } from "@medusajs/framework/workflows-sdk";
import { sendJoinPromptStep } from "./steps/send-join-prompt";

export type SendJoinPromptWorkflowInput = {
	phoneNumber: string;
};

/**
 * Sends the "Reply JOIN to confirm" prompt SMS triggered by a checkout consent checkbox. See
 * `../api/store/sms-consent/join-prompt/route.ts` for the rate limiting this is called behind.
 * @param {WorkflowData<SendJoinPromptWorkflowInput>} input - The phone number to prompt.
 * @returns {WorkflowResponse} The created notification.
 */
export const sendJoinPromptWorkflow = createWorkflow("send-join-prompt", (input: WorkflowData<SendJoinPromptWorkflowInput>) => {
	return new WorkflowResponse(sendJoinPromptStep(input));
});
