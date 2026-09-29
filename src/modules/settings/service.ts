import { MedusaService, MedusaError } from "@medusajs/framework/utils";
import AccountLink from "./models/account-link";
import JobState from "./models/job-state";
import { resolveJobActiveSince } from "../../utils/jobActiveWindow";

export type SaveAccountLinkInput = {
	apiKeyCiphertext: string;
	apiKeyLast4: string;
	groupId: string;
	subgroupId: string;
};

export type SaveBrandStatusInput = {
	brandId: string;
	brandCarrierId: string | null;
	brandStatus: string;
};

/**
 * Persistence only, no Signal House SDK calls — same division of responsibility as
 * `sms-consent/service.ts`. The workflows in `../../workflows/` own verifying an API key, ensuring a
 * subgroup exists, and calling `/brand`; this service only ever reads and writes the one
 * `account_link` row this install has.
 */
class SettingsModuleService extends MedusaService({
	AccountLink,
	JobState,
}) {
	/**
	 * Returns this install's account link, or null if no API key has been connected yet.
	 * @async
	 * @returns {Promise<object | null>} The single `account_link` row, or null.
	 */
	async getAccountLink() {
		const links = await this.listAccountLinks({}, { take: 1 });
		return links[0] ?? null;
	}

	/**
	 * Records a scheduled job run and returns when the job's current active period started. Used by
	 * jobs that must not act on records that went stale before they were switched on. The period
	 * restarts when the job has never run or has not run for longer than `JOB_RESUME_GAP_MS`.
	 * @async
	 * @param {string} name - The job's stable state key.
	 * @param {Date} [now] - The current run's time.
	 * @returns {Promise<{ activeSince: Date, restarted: boolean }>} The period start and whether this run began it.
	 */
	async recordJobTick(name: string, now: Date = new Date()) {
		const [existing] = await this.listJobStates({ name }, { take: 1 });
		const { activeSince, restarted } = resolveJobActiveSince(existing ?? null, now);

		if (existing) {
			await this.updateJobStates([{ id: existing.id, active_since: activeSince, last_tick_at: now }]);
		} else {
			await this.createJobStates({ name, active_since: activeSince, last_tick_at: now });
		}

		return { activeSince, restarted };
	}

	/**
	 * Creates or replaces this install's account link. There is at most one row: a re-connect (a new
	 * API key pasted over an existing link) overwrites it rather than accumulating history. Brand
	 * state is only cleared when the verified `groupId` actually changed — a same-account key
	 * rotation (the UI's "Change key" action on an already-linked install) must not forget an
	 * already-submitted brand: `/brand` reserves a real fee and creates a live TCR registration on
	 * every call with no dedupe, so losing `brand_id` here would let "Submit for review" register
	 * (and bill) a second brand for the same business.
	 * @async
	 * @param {SaveAccountLinkInput} input - The verified link to persist.
	 * @returns {Promise<object>} The saved `account_link` row.
	 */
	async saveAccountLink(input: SaveAccountLinkInput) {
		const existing = await this.getAccountLink();
		const sameAccount = existing?.group_id === input.groupId;

		const data = {
			api_key_ciphertext: input.apiKeyCiphertext,
			api_key_last4: input.apiKeyLast4,
			group_id: input.groupId,
			subgroup_id: input.subgroupId,
			verified_at: new Date(),
			brand_id: sameAccount ? existing!.brand_id : null,
			brand_carrier_id: sameAccount ? existing!.brand_carrier_id : null,
			brand_status: sameAccount ? existing!.brand_status : null,
			brand_synced_at: sameAccount ? existing!.brand_synced_at : null,
			// Unconditional, unlike the brand fields above — this is a merchant preference about their
			// own SMS cost assumption, not state tied to which Signal House account is linked, so it
			// survives even a genuine account change (see the model's own JSDoc).
			sms_cost_per_segment_cents: existing?.sms_cost_per_segment_cents ?? null,
		};

		if (existing) {
			const [updated] = await this.updateAccountLinks([{ id: existing.id, ...data }]);
			return updated;
		}
		return this.createAccountLinks(data);
	}

	/**
	 * Updates the stored brand state on this install's account link.
	 * @async
	 * @param {SaveBrandStatusInput} input - The brand state to persist.
	 * @returns {Promise<object>} The updated `account_link` row.
	 * @throws {MedusaError} - When no account link exists yet to attach a brand to.
	 */
	async saveBrandStatus(input: SaveBrandStatusInput) {
		const existing = await this.getAccountLink();
		if (!existing) {
			throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "settings: cannot save brand status before an account is linked");
		}

		const [updated] = await this.updateAccountLinks([{
			id: existing.id,
			brand_id: input.brandId,
			brand_carrier_id: input.brandCarrierId,
			brand_status: input.brandStatus,
			brand_synced_at: new Date(),
		}]);
		return updated;
	}

	/**
	 * Sets the merchant's per-segment SMS cost assumption, used only as the ROI cost basis in
	 * `GET /admin/signalhouse/analytics/attribution`. Still a deliberate stand-in, not superseded by
	 * The account-level subscription/wallet visibility: the real per-segment cost varies by
	 * destination carrier (the subscription template's rate card is per-segment-per-carrier, not a
	 * flat number), so deriving a live figure automatically is a materially bigger feature this
	 * plugin doesn't attempt — the merchant's own flat assumption is what ROI is computed from.
	 * `null` clears it back to "not configured," under which that route omits ROI entirely rather
	 * than dividing by zero or a guessed default.
	 * @async
	 * @param {number | null} cents - The cost per SMS segment, in cents.
	 * @returns {Promise<object>} The updated `account_link` row.
	 * @throws {MedusaError} - When no account link exists yet.
	 */
	async setSmsCostPerSegmentCents(cents: number | null) {
		const existing = await this.getAccountLink();
		if (!existing) {
			throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "settings: cannot set pricing before an account is linked");
		}

		const [updated] = await this.updateAccountLinks([{ id: existing.id, sms_cost_per_segment_cents: cents }]);
		return updated;
	}
}

export default SettingsModuleService;
