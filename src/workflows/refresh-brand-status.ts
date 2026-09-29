import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { getAccountLinkStep } from "./steps/get-account-link";
import { fetchBrandStatusStep } from "./steps/fetch-brand-status";
import { saveBrandStatusStep } from "./steps/save-brand-status";

/**
 * Re-reads the linked brand's current status from Signal House and persists it. Backs the admin
 * settings screen's manual "Refresh status" action — there is no automatic polling.
 * @returns {WorkflowResponse} The updated account link, carrying the refreshed brand state.
 */
export const refreshBrandStatusWorkflow = createWorkflow("refresh-brand-status", () => {
	const accountLink = getAccountLinkStep();
	const status = fetchBrandStatusStep({ accountLink });
	const updated = saveBrandStatusStep(status);

	return new WorkflowResponse({ accountLink: updated });
});
