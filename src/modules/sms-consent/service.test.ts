import { test } from "node:test";
import assert from "node:assert/strict";
import SmsConsentModuleService from "./service";

const PHONE = "+15555550199";
const NORMALIZED_PHONE = "5555550199";
const CUSTOMER_ID = "cus_1";

// Filter-aware: only checks the keys the caller actually passed, so a query that doesn't ask
// about a field (e.g. checkEligibilityByPhone never filters on customer_id) matches regardless of
// what that field holds on the fixture — mirroring how a real repository filter behaves.
function buildService(records: any[]) {
	const service = Object.create(SmsConsentModuleService.prototype) as any;
	const created: any[] = [];
	service.listConsentRecords = async (filters: any) => {
		return [...records, ...created].filter((r) => {
			for (const key of Object.keys(filters)) {
				if (r[key] !== filters[key]) {
					return false;
				}
			}
			return true;
		});
	};
	service.createConsentRecords = async (data: any) => {
		const record = { id: `conrec_created_${created.length}`, revoked_at: null, ...data };
		created.push(record);
		return record;
	};
	return service as SmsConsentModuleService;
}

test("checkEligibility() is ineligible when no consent record exists (fail closed)", async () => {
	const service = buildService([]);
	const result = await service.checkEligibility(CUSTOMER_ID, PHONE, "transactional");
	assert.equal(result.eligible, false);
	assert.equal(result.reason, "no_consent_record");
});

test("checkEligibility() is eligible with an active grant for the same phone number", async () => {
	const service = buildService([
		{ id: "conrec_1", customer_id: CUSTOMER_ID, phone_number: NORMALIZED_PHONE, purpose: "transactional", revoked_at: null, granted_at: new Date() },
	]);
	const result = await service.checkEligibility(CUSTOMER_ID, PHONE, "transactional");
	assert.equal(result.eligible, true);
	assert.equal(result.consentRecordId, "conrec_1");
});

test("checkEligibility() is ineligible once the latest record is revoked", async () => {
	const service = buildService([
		{ id: "conrec_2", customer_id: CUSTOMER_ID, phone_number: NORMALIZED_PHONE, purpose: "transactional", revoked_at: new Date(), granted_at: new Date() },
	]);
	const result = await service.checkEligibility(CUSTOMER_ID, PHONE, "transactional");
	assert.equal(result.eligible, false);
	assert.equal(result.reason, "revoked");
});

test("checkEligibility() falls back to no_consent_record when the customer's grant is for a different number and the target number has none of its own", async () => {
	const service = buildService([
		{ id: "conrec_3", customer_id: CUSTOMER_ID, phone_number: "5555550000", purpose: "transactional", revoked_at: null, granted_at: new Date() },
	]);
	const result = await service.checkEligibility(CUSTOMER_ID, PHONE, "transactional");
	assert.equal(result.eligible, false);
	assert.equal(result.reason, "no_consent_record");
});

test("checkEligibility() falls back to a phone-only grant (e.g. a JOIN-keyword opt-in) with no customer_id", async () => {
	// A JOIN grant always has customer_id: null (an inbound SMS reply can't be tied to a browsing
	// session) — a logged-in customer's own JOIN opt-in must still be found.
	const service = buildService([
		{ id: "conrec_join", customer_id: null, phone_number: NORMALIZED_PHONE, purpose: "marketing", revoked_at: null, granted_at: new Date() },
	]);
	const result = await service.checkEligibility(CUSTOMER_ID, PHONE, "marketing");
	assert.equal(result.eligible, true);
	assert.equal(result.consentRecordId, "conrec_join");
});

test("checkEligibility() every purpose is gated the same way, including transactional", async () => {
	const service = buildService([]);
	for (const purpose of ["marketing", "cart_recovery", "ai_reply", "transactional"] as const) {
		const result = await service.checkEligibility(CUSTOMER_ID, PHONE, purpose);
		assert.equal(result.eligible, false, `${purpose} should not be consent-exempt`);
	}
});

test("checkEligibility() normalizes differently-formatted input to match a stored grant", async () => {
	const service = buildService([
		{ id: "conrec_fmt", customer_id: CUSTOMER_ID, phone_number: NORMALIZED_PHONE, purpose: "transactional", revoked_at: null, granted_at: new Date() },
	]);
	const result = await service.checkEligibility(CUSTOMER_ID, "(555) 555-0199", "transactional");
	assert.equal(result.eligible, true);
});

test("checkEligibilityByPhone() is ineligible when no consent record exists (fail closed) — guest cart path", async () => {
	const service = buildService([]);
	const result = await service.checkEligibilityByPhone(PHONE, "cart_recovery");
	assert.equal(result.eligible, false);
	assert.equal(result.reason, "no_consent_record");
});

test("checkEligibilityByPhone() is eligible with an active grant", async () => {
	const service = buildService([
		{ id: "conrec_4", phone_number: NORMALIZED_PHONE, purpose: "cart_recovery", revoked_at: null, granted_at: new Date() },
	]);
	const result = await service.checkEligibilityByPhone(PHONE, "cart_recovery");
	assert.equal(result.eligible, true);
	assert.equal(result.consentRecordId, "conrec_4");
});

test("checkEligibilityByPhone() is ineligible once the latest record is revoked", async () => {
	const service = buildService([
		{ id: "conrec_5", phone_number: NORMALIZED_PHONE, purpose: "cart_recovery", revoked_at: new Date(), granted_at: new Date() },
	]);
	const result = await service.checkEligibilityByPhone(PHONE, "cart_recovery");
	assert.equal(result.eligible, false);
	assert.equal(result.reason, "revoked");
});

test("checkEligibilityByPhone() treats an unnormalizable phone as no match, not a crash", async () => {
	const service = buildService([]);
	const result = await service.checkEligibilityByPhone("not-a-phone", "cart_recovery");
	assert.equal(result.eligible, false);
	assert.equal(result.reason, "no_consent_record");
});

test("grantConsent() stores the normalized phone number regardless of input format", async () => {
	const service = buildService([]);
	const record: any = await service.grantConsent(null, "+1 (555) 555-0199", "marketing", { source: "keyword_optin" });
	assert.equal(record.phone_number, NORMALIZED_PHONE);
});

test("grantConsent() throws on a phone number that can't be normalized", async () => {
	const service = buildService([]);
	await assert.rejects(() => service.grantConsent(null, "not-a-phone", "marketing", { source: "keyword_optin" }));
});

test("revokeByPhone() normalizes before matching, so a differently-formatted STOP reply still revokes", async () => {
	const service = buildService([
		{ id: "conrec_6", phone_number: NORMALIZED_PHONE, revoked_at: null, granted_at: new Date() },
	]);
	service.updateConsentRecords = async (updates: any[]) => updates;
	const result = await service.revokeByPhone("(555) 555-0199", "keyword_stop");
	assert.equal(result.length, 1);
	assert.equal(result[0].id, "conrec_6");
});
