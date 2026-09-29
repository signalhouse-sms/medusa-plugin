import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { buildSignalHouseClient, unwrapSignalHouseResponse } from "../../utils/signalHouseClient";
import { pickExistingSubgroupId } from "../../utils/brandPayload";

export type EnsureSubgroupStepInput = {
	apiKey: string;
	groupId: string;
	storeName: string;
};

type SubgroupRecord = { subgroupId: string; status?: string };

/** Set only when this step created a new subgroup — see the compensation note below. */
type EnsureSubgroupCompensateInput = { apiKey: string; subgroupId: string } | undefined;

/**
 * Ensures the linked Signal House group has a subgroup to register a brand and campaigns under —
 * `/brand` requires a `subgroupId` (the Signal House SDK's `CreateBrandData`).
 * Reuses the account's first *active* existing subgroup if it has one (see `pickExistingSubgroupId`
 * — an inactive one is unusable and must not be picked), otherwise creates one named after the
 * Medusa store, mirroring `CreateSubgroupData`'s only two required fields
 * (the Signal House SDK's subgroup API): `groupId` and `subgroupName`.
 *
 * The compensation only ever fires for a subgroup THIS step created (`compensateInput` is undefined
 * when an existing subgroup was reused, via `StepResponse`'s second argument) — reversing a reuse
 * would delete a subgroup the merchant already had before this workflow ever ran.
 * @param {EnsureSubgroupStepInput} input - The verified API key, its groupId, and a name to create a
 *   new subgroup under if none exists yet.
 * @returns {Promise<StepResponse>} The subgroup id to register brands/campaigns under.
 */
export const ensureSubgroupStep = createStep(
	"ensure-subgroup",
	async (input: EnsureSubgroupStepInput) => {
		const client = buildSignalHouseClient(input.apiKey);

		const existingResponse = await client.subgroups.getSubgroups({ groupId: input.groupId });
		const existing = unwrapSignalHouseResponse<SubgroupRecord[]>(existingResponse, "Could not read this account's subgroups");
		const reused = pickExistingSubgroupId(Array.isArray(existing) ? existing : []);
		if (reused) {
			return new StepResponse({ subgroupId: reused }, undefined as EnsureSubgroupCompensateInput);
		}

		const createdResponse = await client.subgroups.createSubgroup({
			subgroupData: { groupId: input.groupId, subgroupName: input.storeName },
		});
		const created = unwrapSignalHouseResponse<SubgroupRecord>(createdResponse, "Could not create a subgroup for this store");

		// Second StepResponse argument is what the compensation function below receives — set only
		// on the "we created one" path, so a reused subgroup is never eligible for compensation.
		const compensateInput: EnsureSubgroupCompensateInput = { apiKey: input.apiKey, subgroupId: created.subgroupId };
		return new StepResponse({ subgroupId: created.subgroupId }, compensateInput);
	},
	async (compensateInput: EnsureSubgroupCompensateInput, { container }) => {
		if (!compensateInput) return;
		const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
		try {
			const client = buildSignalHouseClient(compensateInput.apiKey);
			await client.subgroups.deleteSubgroup({ id: compensateInput.subgroupId });
		} catch (err) {
			// Best-effort: a failed rollback here must not mask the original workflow error, and
			// leaves at most one orphaned subgroup for manual cleanup rather than looping forever.
			logger.error(`ensure-subgroup: failed to roll back subgroup ${compensateInput.subgroupId}: ${(err as Error).message}`);
		}
	},
);
