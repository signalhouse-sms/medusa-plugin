import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySignalHouseWebhookSignature } from "./webhookSignature";

const SECRET = "test-signing-secret";

function sign(timestamp: string, rawBody: string, secret = SECRET) {
	return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

test("verifySignalHouseWebhookSignature() accepts a correctly signed payload", () => {
	const timestamp = "1725000000000";
	const rawBody = JSON.stringify({ event: "MESSAGE_RECEIVED" });
	const signature = sign(timestamp, rawBody);

	assert.equal(verifySignalHouseWebhookSignature(rawBody, timestamp, signature, SECRET), true);
});

test("verifySignalHouseWebhookSignature() rejects a tampered body", () => {
	const timestamp = "1725000000000";
	const rawBody = JSON.stringify({ event: "MESSAGE_RECEIVED" });
	const signature = sign(timestamp, rawBody);
	const tamperedBody = JSON.stringify({ event: "MESSAGE_RECEIVED", extra: "injected" });

	assert.equal(verifySignalHouseWebhookSignature(tamperedBody, timestamp, signature, SECRET), false);
});

test("verifySignalHouseWebhookSignature() rejects a signature made with the wrong secret", () => {
	const timestamp = "1725000000000";
	const rawBody = JSON.stringify({ event: "MESSAGE_RECEIVED" });
	const signature = sign(timestamp, rawBody, "wrong-secret");

	assert.equal(verifySignalHouseWebhookSignature(rawBody, timestamp, signature, SECRET), false);
});

test("verifySignalHouseWebhookSignature() rejects a garbage signature without throwing", () => {
	const timestamp = "1725000000000";
	const rawBody = JSON.stringify({ event: "MESSAGE_RECEIVED" });

	assert.equal(verifySignalHouseWebhookSignature(rawBody, timestamp, "not-hex-!!", SECRET), false);
	assert.equal(verifySignalHouseWebhookSignature(rawBody, timestamp, "", SECRET), false);
});
