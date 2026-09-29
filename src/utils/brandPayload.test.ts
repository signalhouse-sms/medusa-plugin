import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBrandCreatePayload, digitsOnly, normalizeWebsite, pickExistingSubgroupId } from "./brandPayload";
import type { BrandFormInput } from "./brandPayload";

const BASE_FORM: BrandFormInput = {
	legalCompanyName: "Acme LLC",
	entityType: "PRIVATE_PROFIT",
	country: "US",
	ein: "12-3456789",
	street: "123 Main St",
	city: "Austin",
	state: "TX",
	postalCode: "78701",
	firstName: "Jane",
	lastName: "Doe",
	email: "jane@acme.test",
	phone: "5125550100",
	vertical: "RETAIL",
};

test("buildBrandCreatePayload maps the form onto CreateBrandData fields", () => {
	const payload = buildBrandCreatePayload("SG12345678", BASE_FORM);
	assert.equal(payload.subgroupId, "SG12345678");
	assert.equal(payload.companyName, "Acme LLC");
	assert.equal(payload.displayName, "Acme LLC");
	assert.equal(payload.stockSymbol, "");
	assert.equal(payload.stockExchange, "NONE");
	assert.equal(payload.businessContactEmail, undefined);
});

test("displayName prefers dba over legalCompanyName when both are given", () => {
	const payload = buildBrandCreatePayload("SG12345678", { ...BASE_FORM, dba: "Acme Store" });
	assert.equal(payload.displayName, "Acme Store");
	assert.equal(payload.companyName, "Acme LLC");
});

test("NON_PROFIT sets businessContactEmail to the contact email; PRIVATE_PROFIT does not", () => {
	const nonProfit = buildBrandCreatePayload("SG12345678", { ...BASE_FORM, entityType: "NON_PROFIT" });
	assert.equal(nonProfit.businessContactEmail, "jane@acme.test");

	const privateProfit = buildBrandCreatePayload("SG12345678", BASE_FORM);
	assert.equal(privateProfit.businessContactEmail, undefined);
});

test("buildBrandCreatePayload strips display-formatted EIN and phone down to bare digits", () => {
	const payload = buildBrandCreatePayload("SG12345678", { ...BASE_FORM, ein: "12-3456789", phone: "(512) 555-0100" });
	assert.equal(payload.ein, "123456789");
	assert.equal(payload.phone, "5125550100");
});

test("buildBrandCreatePayload omits website entirely when blank, rather than sending an empty string", () => {
	const payload = buildBrandCreatePayload("SG12345678", { ...BASE_FORM, website: "" });
	assert.equal("website" in payload, false);
});

test("buildBrandCreatePayload normalizes a scheme-less website", () => {
	const payload = buildBrandCreatePayload("SG12345678", { ...BASE_FORM, website: "acme.test" });
	assert.equal(payload.website, "https://acme.test");
});

test("normalizeWebsite adds https:// to a bare domain", () => {
	assert.equal(normalizeWebsite("acme.test"), "https://acme.test");
});

test("normalizeWebsite passes through an already-valid URL, stripping a trailing slash", () => {
	assert.equal(normalizeWebsite("https://acme.test/"), "https://acme.test");
});

test("normalizeWebsite returns empty string for blank or unparseable input", () => {
	assert.equal(normalizeWebsite(""), "");
	assert.equal(normalizeWebsite(undefined), "");
	assert.equal(normalizeWebsite("not a url"), "");
});

test("digitsOnly strips everything but digits", () => {
	assert.equal(digitsOnly("(512) 555-0100"), "5125550100");
	assert.equal(digitsOnly("12-3456789"), "123456789");
});

test("pickExistingSubgroupId reuses the first active subgroup", () => {
	assert.equal(
		pickExistingSubgroupId([{ subgroupId: "SG1", status: "active" }, { subgroupId: "SG2", status: "active" }]),
		"SG1",
	);
});

test("pickExistingSubgroupId returns null when there are no subgroups yet", () => {
	assert.equal(pickExistingSubgroupId([]), null);
});

test("pickExistingSubgroupId skips an inactive subgroup and picks the next active one", () => {
	assert.equal(
		pickExistingSubgroupId([{ subgroupId: "SG_INACTIVE", status: "inactive" }, { subgroupId: "SG2", status: "active" }]),
		"SG2",
	);
});

test("pickExistingSubgroupId returns null when every subgroup is inactive, so a new one gets created", () => {
	assert.equal(pickExistingSubgroupId([{ subgroupId: "SG1", status: "inactive" }]), null);
});
