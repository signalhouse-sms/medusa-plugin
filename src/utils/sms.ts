import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { normalizeNanpPhone } from "./phoneNumber";

// Ports app/utils/stopFooter.js's rule: append the footer only when the body doesn't already
// mention STOP and this is the number's first outbound from this store. Repeating it on every
// send trains recipients to ignore it, but a genuinely first message must carry it (CTIA).
const STOP_FOOTER = "\nReply STOP to opt out.";
const STOP_MENTION = /\bstop\b/i;

/**
 * Appends the CTIA-required opt-out footer to an SMS body when this is the first
 * successfully-delivered SMS this store has ever sent to `phone` (and the body doesn't already
 * mention STOP). Shared by every send site in this plugin — order-placed, shipment-created, and
 * cart-abandonment — so "a prior outbound exists" reliably implies "the footer was already
 * delivered," which only holds if every site applies the same rule.
 *
 * Scoped to `status = 'success'` via raw SQL rather than `notificationModuleService.listNotifications`:
 * `status` isn't one of the fields `FilterableNotificationProps` exposes
 * (`@medusajs/types/notification/common.d.ts`), and a failed send never actually reached the
 * recipient, so it must not count as "the footer was already delivered."
 *
 * Compares on a normalized (last-10-digits) form of the stored `to` rather than an exact string
 * match: different send sites store the recipient in whatever format they naturally have it
 * (free-text checkout input, Infobip's bare-digit inbound sender field, a customer record's own
 * format) — an exact match would silently stop working the moment two sites represent the same
 * real number differently, which was a real regression once a second format
 * entered the picture. If the input phone itself can't be normalized, this fails safe by treating
 * it as "no prior outbound found" (footer included) rather than guessing.
 * @async
 * @param {MedusaContainer} container - The Medusa container.
 * @param {string} phone - The recipient phone number.
 * @param {string} body - The message body before the footer decision.
 * @returns {Promise<string>} `body`, with the footer appended when required.
 */
export async function withStopFooter(container: MedusaContainer, phone: string, body: string): Promise<string> {
	if (STOP_MENTION.test(body)) {
		return body;
	}

	const normalizedPhone = normalizeNanpPhone(phone);
	if (!normalizedPhone) {
		return `${body}${STOP_FOOTER}`;
	}

	const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
	const { rows } = await pgConnection.raw(
		`select 1 from notification where channel = 'sms' and status = 'success' and right(regexp_replace("to", '\\D', '', 'g'), 10) = ? limit 1`,
		[normalizedPhone],
	);

	return rows.length ? body : `${body}${STOP_FOOTER}`;
}
