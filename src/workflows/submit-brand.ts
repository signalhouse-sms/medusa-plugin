import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import type { WorkflowData } from "@medusajs/framework/workflows-sdk";
import { getAccountLinkStep } from "./steps/get-account-link";
import { createBrandStep } from "./steps/create-brand";
import type { BrandFormInput } from "./steps/create-brand";

export type { BrandFormInput };

/**
 * Submits a 10DLC brand for the linked Signal House account. `createBrandStep` persists the result
 * itself, in the same step as the billed `/brand` call — see its own JSDoc for why that call and its
 * persistence must not be split across two steps. Backs the admin settings screen's "Submit for
 * review" action.
 * @param {WorkflowData<BrandFormInput>} input - The brand form fields.
 * @returns {WorkflowResponse} The updated account link, carrying the new brand state.
 */
export const submitBrandWorkflow = createWorkflow("submit-brand", (input: WorkflowData<BrandFormInput>) => {
	const accountLink = getAccountLinkStep();
	const updated = createBrandStep({ accountLink, brandForm: input });

	return new WorkflowResponse({ accountLink: updated });
});
