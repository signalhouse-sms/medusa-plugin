import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import type { WorkflowData } from "@medusajs/framework/workflows-sdk";
import { verifyApiKeyStep } from "./steps/verify-api-key";
import { ensureSubgroupStep } from "./steps/ensure-subgroup";
import { saveAccountLinkStep } from "./steps/save-account-link";

export type LinkAccountWorkflowInput = {
	apiKey: string;
	/** Name to create a new subgroup under if the linked account has none yet. */
	storeName: string;
};

/**
 * Links this Medusa install to a Signal House account: verifies the pasted API key, ensures a
 * subgroup exists to register a brand/campaigns under, and persists the (encrypted) link. Backs the
 * admin settings screen's "Connect" action.
 * @param {WorkflowData<LinkAccountWorkflowInput>} input - The API key to link and a store name to
 *   fall back to if a new subgroup needs creating.
 * @returns {WorkflowResponse} The saved account link.
 */
export const linkAccountWorkflow = createWorkflow("link-account", (input: WorkflowData<LinkAccountWorkflowInput>) => {
	const { groupId } = verifyApiKeyStep({ apiKey: input.apiKey });
	const { subgroupId } = ensureSubgroupStep({ apiKey: input.apiKey, groupId, storeName: input.storeName });
	const accountLink = saveAccountLinkStep({ apiKey: input.apiKey, groupId, subgroupId });

	return new WorkflowResponse({ accountLink });
});
