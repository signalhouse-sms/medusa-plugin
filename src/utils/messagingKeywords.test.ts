import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeKeywordBody, isOptOutKeyword } from "./messagingKeywords";

test("normalizeKeywordBody() strips leading/trailing punctuation and lowercases", () => {
	assert.equal(normalizeKeywordBody("Stop!"), "stop");
	assert.equal(normalizeKeywordBody("Stop."), "stop");
	assert.equal(normalizeKeywordBody("  UNSUBSCRIBE  "), "unsubscribe");
});

test("normalizeKeywordBody() collapses internal whitespace", () => {
	assert.equal(normalizeKeywordBody("opt   out"), "opt out");
});

test("normalizeKeywordBody() returns empty string for non-string input", () => {
	assert.equal(normalizeKeywordBody(undefined as any), "");
});

test("isOptOutKeyword() matches every mandatory keyword", () => {
	for (const keyword of ["stop", "stopall", "stop all", "quit", "end", "revoke", "optout", "opt out", "opt-out", "cancel", "unsubscribe"]) {
		assert.equal(isOptOutKeyword(keyword), true, `${keyword} should be recognized`);
	}
});

test("isOptOutKeyword() matches case/punctuation variants after normalization", () => {
	assert.equal(isOptOutKeyword(normalizeKeywordBody("STOPALL")), true);
	assert.equal(isOptOutKeyword(normalizeKeywordBody("Cancel.")), true);
});

test("isOptOutKeyword() rejects a substring match — whole-message only", () => {
	assert.equal(isOptOutKeyword(normalizeKeywordBody("I want to cancel my stop request")), false);
});

test("isOptOutKeyword() rejects JOIN", () => {
	assert.equal(isOptOutKeyword(normalizeKeywordBody("join")), false);
});
