import { model } from "@medusajs/framework/utils";

/**
 * The Medusa install's link to a Signal House account, plus the state of its one 10DLC brand.
 *
 * Exactly one row is expected per install — this plugin runs inside a single merchant's own
 * self-hosted Medusa instance, unlike the Shopify app's per-shop rows, so there is no
 * tenant-scoping key to index on. `api_key_ciphertext` is never returned to the admin UI;
 * `api_key_last4` exists so the UI can show "connected as ...1234" without ever decrypting the key
 * for display. `brand_id` is Signal House's Mongo `_id` (present as soon as `/brand` returns
 * 201, used to poll status); `brand_carrier_id` is the carrier-assigned Brand ID, null until TCR
 * assigns one (the Signal House SDK's own `BrandLookupId` contract).
 *
 * `sms_cost_per_segment_cents` (attribution analytics) is a merchant-set stand-in for real billing
 * data — this plugin has no processor integration yet (deferred pending a processor
 * decision), so the attribution analytics' ROI figure needs *some* cost basis to divide by. Lives
 * on this single settings row rather than a new table: it is a merchant preference independent of
 * which Signal House account is linked, not account/brand state, so `saveAccountLink` preserves it
 * across a reconnect even when the verified account changes (unlike `brand_id` et al., which reset
 * on a genuine account change — see that method's own JSDoc).
 */
const AccountLink = model
	.define("account_link", {
		id: model.id().primaryKey(),
		api_key_ciphertext: model.text(),
		api_key_last4: model.text(),
		group_id: model.text(),
		subgroup_id: model.text(),
		verified_at: model.dateTime(),
		brand_id: model.text().nullable(),
		brand_carrier_id: model.text().nullable(),
		brand_status: model.text().nullable(),
		brand_synced_at: model.dateTime().nullable(),
		sms_cost_per_segment_cents: model.number().nullable(),
	});

export default AccountLink;
