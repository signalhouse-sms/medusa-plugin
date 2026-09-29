import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import type { WorkflowData } from "@medusajs/framework/workflows-sdk";
import { resolveBroadcastAudienceStep } from "./steps/resolve-broadcast-audience";
import { createBroadcastStep } from "./steps/create-broadcast";

export type CreateBroadcastWorkflowInput = {
	messageBody: string;
	/** Null means "every marketing-consented customer." */
	customerGroupId: string | null;
	/** Null means "send as soon as the next `jobs/broadcast-send.ts` tick runs." */
	scheduledAt: Date | null;
};

/**
 * Resolves the marketing-consented audience (optionally scoped to a customer group) and persists a
 * new broadcast with one `broadcast_recipient` row per resolved recipient. Backs
 * `POST /admin/signalhouse/broadcasts`. The actual sends happen later, in
 * `jobs/broadcast-send.ts` — this workflow only resolves who and records the intent.
 * @param {WorkflowData<CreateBroadcastWorkflowInput>} input - The message body, optional audience
 *   scope, and optional schedule time.
 * @returns {WorkflowResponse} The created broadcast.
 */
export const createBroadcastWorkflow = createWorkflow("create-broadcast", (input: WorkflowData<CreateBroadcastWorkflowInput>) => {
	const { recipients } = resolveBroadcastAudienceStep({ customerGroupId: input.customerGroupId });
	const broadcast = createBroadcastStep({
		messageBody: input.messageBody,
		customerGroupId: input.customerGroupId,
		scheduledAt: input.scheduledAt,
		recipients,
	});

	return new WorkflowResponse(broadcast);
});
