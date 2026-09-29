/**
 * Normalizes a phone number to a bare 10-digit NANP form for consent matching, mirroring the
 * Signal House Shopify app's consent-matching normalization. Consent
 * records are stored and compared this way regardless of how the number was originally
 * formatted — free-text checkout input (`"(555) 123-4567"`, `"+1 555 123 4567"`), or Infobip's
 * bare-digit inbound sender field — so the same real number always matches. This only affects
 * consent storage/lookups (`sms-consent/service.ts`); the actual SMS `to` field a caller sends
 * through stays whatever format it already had.
 * @param {string} raw - The phone number as originally captured.
 * @returns {string | null} The bare 10-digit NANP form, or `null` if `raw` can't be normalized to
 *   a plausible NANP number (callers must treat that as "can't be checked/stored," not pass it through).
 */
export function normalizeNanpPhone(raw: string): string | null {
	const digits = raw.replace(/\D/g, "");
	if (digits.length === 11 && digits.startsWith("1")) {
		return digits.slice(1);
	}
	if (digits.length === 10) {
		return digits;
	}
	return null;
}

/**
 * Prepares a phone number for the Signal House SMS API's `recipientPhoneNumbers`/`senderPhoneNumber`
 * wire format: strip everything but digits, at least 10 of them — the API's own
 * send-SMS request schema requires exactly that,
 * nothing NANP-specific.
 *
 * An explicit `+` prefix is treated as "the caller already gave a real country code" and passed
 * through digits-only, UNCHANGED — never reinterpreted as NANP. Only an input with no `+` (bare
 * digits or US-style punctuation, the checkout-typed case this function exists to fix) gets the
 * NANP-preferred treatment, prepending `1` when it's a plausible 10-digit NANP number, matching the
 * Signal House Shopify app's production phone normalization.
 *
 * This split exists because `normalizeNanpPhone` classifies ANY exactly-10-digit string as NANP —
 * correct for its own purpose (consent matching, where a false-positive NANP guess on a foreign
 * number just means a missed dedup) but wrong here: an earlier version of this function called it
 * unconditionally, which silently rewrote a real 10-digit E.164 number with no `+` context
 * preserved — e.g. Denmark's `+45 20 12 34 56` — into a bogus NANP number and sent it to the wrong
 * destination. Fixed by checking for `+` first, before ever consulting `normalizeNanpPhone`
 * (ai-review finding, PR #1326; an earlier version of THIS same fix also broke every non-NANP
 * recipient a different way — see this function's own git history for that first, narrower bug).
 * @param {string} raw - The phone number as originally captured or configured.
 * @returns {string | null} The digits-only wire form, or `null` if fewer than 10 digits remain.
 */
export function normalizeForSignalHouseSend(raw: string): string | null {
	const trimmed = raw.trim();
	if (trimmed.startsWith("+")) {
		const digits = trimmed.replace(/\D/g, "");
		return digits.length >= 10 ? digits : null;
	}

	const nanp = normalizeNanpPhone(trimmed);
	if (nanp) {
		return `1${nanp}`;
	}
	const digits = trimmed.replace(/\D/g, "");
	return digits.length >= 10 ? digits : null;
}
