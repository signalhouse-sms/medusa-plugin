import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a Signal House webhook signature. Ports the exact signing construction
 * the Signal House API uses to sign outbound webhooks:
 * hex HMAC-SHA256 of `` `${timestamp}.${rawBody}` `` using the endpoint's signing secret, sent as
 * the `X-SignalHouse-Signature` header (with `X-SignalHouse-Timestamp` alongside it). Compares
 * with `timingSafeEqual` rather than `===` to avoid leaking the real signature through response-time
 * differences.
 * @param {string} rawBody - The exact raw request body bytes, as a string (not re-serialized JSON —
 *   re-serializing can reorder keys or change whitespace and would never match the sender's signature).
 * @param {string} timestamp - The `X-SignalHouse-Timestamp` header value.
 * @param {string} signature - The `X-SignalHouse-Signature` header value (hex).
 * @param {string} secret - The webhook endpoint's signing secret.
 * @returns {boolean} Whether the signature is valid.
 */
export function verifySignalHouseWebhookSignature(rawBody: string, timestamp: string, signature: string, secret: string): boolean {
	const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");

	const expectedBuffer = Buffer.from(expected, "hex");
	const actualBuffer = Buffer.from(signature, "hex");
	if (expectedBuffer.length !== actualBuffer.length) {
		return false;
	}

	return timingSafeEqual(expectedBuffer, actualBuffer);
}
