export type AccountLinkRow = {
	api_key_last4: string;
	group_id: string;
	subgroup_id: string;
	verified_at: Date | string;
	brand_id: string | null;
	brand_carrier_id: string | null;
	brand_status: string | null;
	brand_synced_at: Date | string | null;
	sms_cost_per_segment_cents?: number | null;
};

/**
 * Maps an `account_link` row to the shape the admin UI is allowed to see. Never includes
 * `api_key_ciphertext` — the encrypted key has no reason to leave the server at all, masked or not.
 * Shared by every admin route that returns account-link state (`settings`, `brand`, `brand/refresh`)
 * so the safe shape is defined in exactly one place.
 * @param {AccountLinkRow | null} accountLink - The row to map, or null if nothing is linked yet.
 * @returns {object} The response body.
 */
export function toAccountLinkResponse(accountLink: AccountLinkRow | null) {
	if (!accountLink) {
		return { linked: false as const };
	}

	return {
		linked: true as const,
		apiKeyLast4: accountLink.api_key_last4,
		groupId: accountLink.group_id,
		subgroupId: accountLink.subgroup_id,
		verifiedAt: accountLink.verified_at,
		smsCostPerSegmentCents: accountLink.sms_cost_per_segment_cents ?? null,
		brand: accountLink.brand_id
			? {
				id: accountLink.brand_id,
				carrierId: accountLink.brand_carrier_id,
				status: accountLink.brand_status,
				syncedAt: accountLink.brand_synced_at,
			}
			: null,
	};
}
