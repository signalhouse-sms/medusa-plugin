/**
 * The mandatory opt-out keyword floor every Signal House campaign enforces, regardless of what a
 * merchant's own campaign configuration adds — matches the Signal House API's mandatory opt-out
 * keyword list verbatim. Matching only "stop" (as this module originally did) would
 * leave `consent_record` reporting a recipient as still opted in — the merchant's TCPA audit
 * artifact — while the platform has already suppressed the number's DNC-listed sends.
 */
export const MANDATORY_OPTOUT_KEYWORDS = Object.freeze([
	"stop",
	"stopall",
	"stop all",
	"quit",
	"end",
	"revoke",
	"optout",
	"opt out",
	"opt-out",
	"cancel",
	"unsubscribe",
]);

/**
 * Normalizes an inbound message body for whole-message keyword matching. Matches the Signal
 * House API's keyword normalization verbatim: NFKC-normalizes,
 * lowercases, strips leading/trailing non-alphanumerics (so `"Stop!"`/`"Stop."` still match), and
 * collapses internal whitespace.
 * @param {string} body - The raw inbound message body.
 * @returns {string} The normalized body, or `""` if `body` isn't a string.
 */
export function normalizeKeywordBody(body: string): string {
	if (typeof body !== "string") {
		return "";
	}
	return body
		.normalize("NFKC")
		.toLowerCase()
		.replace(/^[^\p{L}\p{N}]+/u, "")
		.replace(/[^\p{L}\p{N}]+$/u, "")
		.replace(/\s+/gu, " ")
		.trim();
}

/**
 * Whether a normalized inbound message body is exactly one of the mandatory opt-out keywords —
 * whole-message match, never a substring match (so "I want to cancel my STOP request" doesn't
 * trigger an opt-out).
 * @param {string} normalizedBody - The output of `normalizeKeywordBody`.
 * @returns {boolean} Whether `normalizedBody` is a recognized opt-out keyword.
 */
export function isOptOutKeyword(normalizedBody: string): boolean {
	return (MANDATORY_OPTOUT_KEYWORDS as readonly string[]).includes(normalizedBody);
}
