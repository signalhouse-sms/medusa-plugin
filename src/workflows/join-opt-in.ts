import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import type { WorkflowData } from "@medusajs/framework/workflows-sdk";
import { grantJoinConsentStep } from "./steps/grant-join-consent";
import { sendJoinConfirmationStep } from "./steps/send-join-confirmation";

export type JoinOptInWorkflowInput = {
	phoneNumber: string;
	/** The inbound message's own id — see `SendJoinConfirmationStepInput`'s JSDoc. */
	identifier: string;
	/** The verbatim inbound SMS body — see `GrantJoinConsentStepInput`'s JSDoc. */
	inboundMessageBody: string;
};

/**
 * Runs on a verified inbound JOIN keyword: grants consent for the reference's JOIN purpose set and
 * sends the mandatory confirmation SMS. See `grantJoinConsentStep`/`sendJoinConfirmationStep` for
 * the compensation reasoning on each half.
 * @param {WorkflowData<JoinOptInWorkflowInput>} input - The phone number and inbound message id.
 * @returns {WorkflowResponse} The consent records granted and the confirmation notification.
 */
export const joinOptInWorkflow = createWorkflow("join-opt-in", (input: WorkflowData<JoinOptInWorkflowInput>) => {
	const consentRecords = grantJoinConsentStep(input);
	const confirmation = sendJoinConfirmationStep(input);

	return new WorkflowResponse({ consentRecords, confirmation });
});
