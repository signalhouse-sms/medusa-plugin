import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { BROADCAST_MODULE } from "../../modules/broadcast";
import type BroadcastModuleService from "../../modules/broadcast/service";
import type { ResolvedBroadcastRecipient } from "./resolve-broadcast-audience";

export type CreateBroadcastStepInput = {
	messageBody: string;
	customerGroupId: string | null;
	scheduledAt: Date | null;
	recipients: ResolvedBroadcastRecipient[];
};

/**
 * Persists a broadcast and its resolved recipients. Compensates by deleting both if a later step
 * in the same workflow fails — there is no later step today, but this keeps the same
 * create-then-compensate shape as every other multi-step workflow in this plugin
 * (`ensure-subgroup.ts`, `create-brand.ts`) rather than assuming this will always stay the last
 * step.
 * @param {CreateBroadcastStepInput} input - The message, optional audience scope, optional
 *   schedule time, and the already-resolved recipient list.
 * @returns {Promise<StepResponse>} The created broadcast.
 */
export const createBroadcastStep = createStep(
	"create-broadcast",
	async (input: CreateBroadcastStepInput, { container }) => {
		const broadcastService: BroadcastModuleService = container.resolve(BROADCAST_MODULE);

		const broadcast = await broadcastService.createBroadcastWithRecipients({
			messageBody: input.messageBody,
			customerGroupId: input.customerGroupId,
			scheduledAt: input.scheduledAt,
			recipients: input.recipients,
		});

		return new StepResponse(broadcast, broadcast.id);
	},
	async (broadcastId: string | undefined, { container }) => {
		if (!broadcastId) return;
		const broadcastService: BroadcastModuleService = container.resolve(BROADCAST_MODULE);
		await broadcastService.deleteBroadcastWithRecipients(broadcastId);
	},
);
