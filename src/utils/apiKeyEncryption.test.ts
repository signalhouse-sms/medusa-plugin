import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptApiKey, decryptApiKey, last4 } from "./apiKeyEncryption";

const VALID_KEY = "a".repeat(64);

test("encryptApiKey/decryptApiKey round-trip", () => {
	process.env.SIGNALHOUSE_SETTINGS_ENCRYPTION_KEY = VALID_KEY;
	const ciphertext = encryptApiKey("sh_live_abc123");
	assert.notEqual(ciphertext, "sh_live_abc123");
	assert.equal(decryptApiKey(ciphertext), "sh_live_abc123");
});

test("encrypting the same key twice produces different ciphertext (random IV per call)", () => {
	process.env.SIGNALHOUSE_SETTINGS_ENCRYPTION_KEY = VALID_KEY;
	const a = encryptApiKey("sh_live_abc123");
	const b = encryptApiKey("sh_live_abc123");
	assert.notEqual(a, b);
});

test("throws when the encryption key env var is missing", () => {
	delete process.env.SIGNALHOUSE_SETTINGS_ENCRYPTION_KEY;
	assert.throws(() => encryptApiKey("sh_live_abc123"), /SIGNALHOUSE_SETTINGS_ENCRYPTION_KEY/);
});

test("throws when the encryption key env var is the wrong length", () => {
	process.env.SIGNALHOUSE_SETTINGS_ENCRYPTION_KEY = "not-64-hex-chars";
	assert.throws(() => encryptApiKey("sh_live_abc123"), /SIGNALHOUSE_SETTINGS_ENCRYPTION_KEY/);
});

test("decrypting with a different key fails rather than silently returning garbage", () => {
	process.env.SIGNALHOUSE_SETTINGS_ENCRYPTION_KEY = VALID_KEY;
	const ciphertext = encryptApiKey("sh_live_abc123");
	process.env.SIGNALHOUSE_SETTINGS_ENCRYPTION_KEY = "b".repeat(64);
	assert.throws(() => decryptApiKey(ciphertext));
});

test("last4 returns the last 4 characters", () => {
	assert.equal(last4("sh_live_abc123"), "c123");
});
