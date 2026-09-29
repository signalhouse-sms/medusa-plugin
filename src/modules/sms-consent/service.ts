import { MedusaService, MedusaError } from "@medusajs/framework/utils";
import ConsentRecord from "./models/consent-record";
import { normalizeNanpPhone } from "../../utils/phoneNumber";

export type ConsentPurpose = "marketing" | "cart_recovery" | "ai_reply" | "transactional";

export type ConsentEligibility = {
	eligible: boolean;
	reason?: "no_consent_record" | "revoked";
	consentRecordId?: string;
};

export type GrantConsentDetails = {
	source: string;
	consentText?: string;
	consentVersion?: string;
	ipAddress?: string;
	metadata?: Record<string, unknown>;
};

class SmsConsentModuleService extends MedusaService({
	ConsentRecord,
}) {
	/**
	 * Checks whether a phone number is eligible to receive an SMS for the given purpose. Ports the
	 * layered structure of `consentEligibility.server.js`'s `checkMessageEligibility` — every
	 * purpose, including "transactional", requires an active (non-revoked) grant for that exact
	 * number, not just the account. There is no legacy opted-in fallback: unlike the Shopify app,
	 * this module has no pre-existing data to migrate, so "no record" simply means "not eligible."
	 *
	 * **Not yet enforced**: the reference implementation also restricts each purpose to a specific
	 * allow-list of consent sources (`PURPOSE_CONFIG.acceptedSources` — e.g. `marketing`/
	 * `cart_recovery` require express-written sources only). This module does not enforce that
	 * allow-list yet — as of the consent-capture and JOIN keyword work, `keyword_optin` (the JOIN-keyword grant, verified via
	 * a real carrier-confirmed inbound SMS — see `../../api/webhooks/signalhouse/route.ts`) is a
	 * genuinely compliant, allow-listable source, matching the reference's own
	 * `MARKETING_CONSENT_SOURCES`. So the remaining gap is narrower than before: *enforcement* of
	 * the allow-list (rejecting a hypothetical non-compliant source), not "no compliant source
	 * exists to check against" — there is one now. `transactional` (the order/shipment subscribers)
	 * has no gap in practice — every real source it would see is already in the reference's widest,
	 * most-permissive accepted-source set. `cart_recovery` (the cart-abandonment job) stays disabled by
	 * default (`SIGNALHOUSE_CART_ABANDONMENT_ENABLED`) until the allow-list is actually enforced,
	 * since today `checkEligibility` would treat ANY source as sufficient, not just `keyword_optin`.
	 * Falls back to `checkEligibilityByPhone` whenever the customer-scoped grant doesn't itself
	 * resolve eligibility (no record, revoked, or for a different number) — a JOIN-keyword grant
	 * (`../../workflows/steps/grant-join-consent.ts`) always has `customer_id: null`, since an
	 * inbound SMS reply can't be tied to a browsing session, so a logged-in customer's own JOIN
	 * opt-in would otherwise be invisible to this customer-scoped lookup. Consent is a property of
	 * the phone number first; the customer link is an optimization, not the source of truth.
	 * @async
	 * @param {string} customerId - The Medusa customer id.
	 * @param {string} phoneNumber - The number the message would actually be sent to.
	 * @param {ConsentPurpose} purpose - The purpose to check eligibility for.
	 * @returns {Promise<ConsentEligibility>} Whether the number is eligible, and why not if not.
	 */
	async checkEligibility(customerId: string, phoneNumber: string, purpose: ConsentPurpose): Promise<ConsentEligibility> {
		const normalizedPhone = normalizeNanpPhone(phoneNumber);
		if (!normalizedPhone) {
			return { eligible: false, reason: "no_consent_record" };
		}

		const records = await this.listConsentRecords(
			{ customer_id: customerId, purpose },
			{ order: { granted_at: "DESC" }, take: 1 },
		);

		const latest = records[0];
		if (latest && !latest.revoked_at && latest.phone_number === normalizedPhone) {
			return { eligible: true, consentRecordId: latest.id };
		}

		return this.checkEligibilityByPhone(normalizedPhone, purpose);
	}

	/**
	 * Checks eligibility by phone number alone, with no Medusa customer to anchor to — the guest-
	 * checkout counterpart to `checkEligibility`, and the read-side twin of `revokeByPhone`. Same
	 * fail-closed logic (no record, or a revoked latest record, means not eligible).
	 * @async
	 * @param {string} phoneNumber - The number the message would actually be sent to.
	 * @param {ConsentPurpose} purpose - The purpose to check eligibility for.
	 * @returns {Promise<ConsentEligibility>} Whether the number is eligible, and why not if not.
	 */
	async checkEligibilityByPhone(phoneNumber: string, purpose: ConsentPurpose): Promise<ConsentEligibility> {
		const normalizedPhone = normalizeNanpPhone(phoneNumber);
		if (!normalizedPhone) {
			return { eligible: false, reason: "no_consent_record" };
		}

		const records = await this.listConsentRecords(
			{ phone_number: normalizedPhone, purpose },
			{ order: { granted_at: "DESC" }, take: 1 },
		);

		const latest = records[0];
		if (!latest) {
			return { eligible: false, reason: "no_consent_record" };
		}
		if (latest.revoked_at) {
			return { eligible: false, reason: "revoked" };
		}

		return { eligible: true, consentRecordId: latest.id };
	}

	/**
	 * Records a new consent grant for a phone number and purpose. `customerId` is nullable — most
	 * cart abandonment is a guest checkout with no Medusa customer to attach the grant to, and the
	 * phone number is the real identity anchor either way (see `checkEligibilityByPhone`).
	 * @async
	 * @param {string | null} customerId - The Medusa customer id, or null for a guest grant.
	 * @param {string} phoneNumber - The phone number that consented.
	 * @param {ConsentPurpose} purpose - The purpose being granted.
	 * @param {GrantConsentDetails} details - Where/how consent was captured.
	 * @returns {Promise<object>} The created consent record.
	 * @throws {MedusaError} - When `phoneNumber` can't be normalized to a plausible NANP number —
	 *   a garbage input must not create a phantom consent row.
	 */
	async grantConsent(customerId: string | null, phoneNumber: string, purpose: ConsentPurpose, details: GrantConsentDetails) {
		const normalizedPhone = normalizeNanpPhone(phoneNumber);
		if (!normalizedPhone) {
			throw new MedusaError(MedusaError.Types.INVALID_DATA, `sms-consent: "${phoneNumber}" is not a valid NANP phone number`);
		}

		return this.createConsentRecords({
			customer_id: customerId,
			phone_number: normalizedPhone,
			purpose,
			source: details.source,
			granted_at: new Date(),
			consent_text: details.consentText ?? null,
			consent_version: details.consentVersion ?? null,
			ip_address: details.ipAddress ?? null,
			metadata: details.metadata ?? null,
		});
	}

	/**
	 * Revokes every active consent record for one customer and purpose.
	 * @async
	 * @param {string} customerId - The Medusa customer id.
	 * @param {ConsentPurpose} purpose - The purpose to revoke.
	 * @param {string} revocationMethod - How the revocation was triggered (e.g. "keyword_stop").
	 * @returns {Promise<object[]>} The updated consent records.
	 */
	async revokeConsent(customerId: string, purpose: ConsentPurpose, revocationMethod: string) {
		const active = await this.listConsentRecords({ customer_id: customerId, purpose, revoked_at: null });
		return this.updateConsentRecords(
			active.map((record) => ({ id: record.id, revoked_at: new Date(), revocation_method: revocationMethod })),
		);
	}

	/**
	 * Revokes every active consent record across all purposes for a customer.
	 * @async
	 * @param {string} customerId - The Medusa customer id.
	 * @param {string} revocationMethod - How the revocation was triggered.
	 * @returns {Promise<object[]>} The updated consent records.
	 */
	async revokeAllConsent(customerId: string, revocationMethod: string) {
		const active = await this.listConsentRecords({ customer_id: customerId, revoked_at: null });
		return this.updateConsentRecords(
			active.map((record) => ({ id: record.id, revoked_at: new Date(), revocation_method: revocationMethod })),
		);
	}

	/**
	 * Revokes every active consent record for a phone number, regardless of which customer account
	 * it's linked to. This is the key an inbound STOP handler needs: STOP arrives as a phone
	 * number, not a customer id, and there is no reliable phone->customer lookup at that point.
	 * Called from `../../api/webhooks/signalhouse/route.ts` on a verified inbound STOP keyword.
	 * @async
	 * @param {string} phoneNumber - The phone number that sent STOP (or equivalent).
	 * @param {string} revocationMethod - How the revocation was triggered (e.g. "keyword_stop").
	 * @returns {Promise<object[]>} The updated consent records.
	 */
	async revokeByPhone(phoneNumber: string, revocationMethod: string) {
		const normalizedPhone = normalizeNanpPhone(phoneNumber);
		if (!normalizedPhone) {
			return [];
		}

		const active = await this.listConsentRecords({ phone_number: normalizedPhone, revoked_at: null });
		return this.updateConsentRecords(
			active.map((record) => ({ id: record.id, revoked_at: new Date(), revocation_method: revocationMethod })),
		);
	}
}

export default SmsConsentModuleService;
