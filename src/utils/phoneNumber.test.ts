import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeNanpPhone, normalizeForSignalHouseSend } from "./phoneNumber";

test("normalizeNanpPhone() normalizes a bare 10-digit number", () => {
	assert.equal(normalizeNanpPhone("5551234567"), "5551234567");
});

test("normalizeNanpPhone() strips a leading country code 1", () => {
	assert.equal(normalizeNanpPhone("+15551234567"), "5551234567");
	assert.equal(normalizeNanpPhone("15551234567"), "5551234567");
});

test("normalizeNanpPhone() strips formatting punctuation and whitespace", () => {
	assert.equal(normalizeNanpPhone("(555) 123-4567"), "5551234567");
	assert.equal(normalizeNanpPhone("+1 555 123 4567"), "5551234567");
});

test("normalizeNanpPhone() returns null for an unparseable number", () => {
	assert.equal(normalizeNanpPhone("12345"), null);
	assert.equal(normalizeNanpPhone("not a phone number"), null);
	assert.equal(normalizeNanpPhone(""), null);
});

test("normalizeNanpPhone() treats two differently-formatted inputs for the same number as equal", () => {
	assert.equal(normalizeNanpPhone("+15551234567"), normalizeNanpPhone("(555) 123-4567"));
});

test("normalizeForSignalHouseSend() prefers the 11-digit leading-1 NANP form for a NANP number", () => {
	assert.equal(normalizeForSignalHouseSend("5551234567"), "15551234567");
	assert.equal(normalizeForSignalHouseSend("(555) 123-4567"), "15551234567");
	assert.equal(normalizeForSignalHouseSend("+15551234567"), "15551234567");
});

test("normalizeForSignalHouseSend() accepts a non-NANP international number the API itself allows", () => {
	assert.equal(normalizeForSignalHouseSend("+442079460958"), "442079460958");
});

test("normalizeForSignalHouseSend() does NOT reinterpret a 10-digit E.164 international number as NANP", () => {
	// Denmark, Norway, Iceland, Hungary etc. can have a 10-digit national number — normalizeNanpPhone
	// alone can't tell these apart from a US number, so the explicit `+` must be what decides this,
	// not the digit count.
	assert.equal(normalizeForSignalHouseSend("+4520123456"), "4520123456");
	assert.equal(normalizeForSignalHouseSend("+4712345678"), "4712345678");
});

test("normalizeForSignalHouseSend() returns null for fewer than 10 digits", () => {
	assert.equal(normalizeForSignalHouseSend("12345"), null);
	assert.equal(normalizeForSignalHouseSend("not a phone number"), null);
	assert.equal(normalizeForSignalHouseSend("+123"), null);
});
