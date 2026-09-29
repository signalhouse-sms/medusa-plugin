import { model } from "@medusajs/framework/utils";

/**
 * One grant or revocation of SMS consent for a phone number, scoped to a single purpose —
 * `phone_number` is captured at grant time and checked against the number about to be messaged
 * (see `../service.ts`), because a customer profile's phone can change after the grant and
 * consent is a property of the number TCPA governs, not of the account. `customer_id` is
 * nullable: guest checkouts (most cart abandonment) have no Medusa customer to attach to, so the
 * phone number — not the account — is the real identity anchor. Purposes mirror Signal House's
 * own eligibility model.
 */
const ConsentRecord = model
	.define("consent_record", {
		id: model.id().primaryKey(),
		customer_id: model.text().nullable(),
		phone_number: model.text(),
		purpose: model.enum(["marketing", "cart_recovery", "ai_reply", "transactional"]),
		source: model.text(),
		granted_at: model.dateTime(),
		revoked_at: model.dateTime().nullable(),
		revocation_method: model.text().nullable(),
		consent_text: model.text().nullable(),
		consent_version: model.text().nullable(),
		ip_address: model.text().nullable(),
		metadata: model.json().nullable(),
	})
	.indexes([
		// checkEligibility's hot-path lookup, ordered by recency.
		{ on: ["customer_id", "purpose", "granted_at"] },
		// revokeConsent/revokeAllConsent's active-record scan.
		{ on: ["customer_id", "revoked_at"] },
		// checkEligibilityByPhone's hot-path lookup (guest carts), ordered by recency — same
		// shape as the customer_id index above, for the same reason.
		{ on: ["phone_number", "purpose", "granted_at"] },
		// revokeByPhone's active-record scan.
		{ on: ["phone_number", "revoked_at"] },
	]);

export default ConsentRecord;
