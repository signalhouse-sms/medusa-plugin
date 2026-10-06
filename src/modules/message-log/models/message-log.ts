import { model } from "@medusajs/framework/utils";

/**
 * One outbound SMS this plugin sent, tracked from send through carrier delivery. `external_id` is
 * Signal House's own message `_id` — the same value `notification.external_id` already carries
 * (`@medusajs/notification`'s module service sets it from whatever the provider's `send()` returns,
 * and `providers/signalhouse-sms/service.ts`'s `send()` already returns `{ id: messageId }`), and the
 * `identifier` a delivery-receipt (DLR) webhook reports against
 * (the Signal House `MESSAGE_DELIVERED`/`MESSAGE_FAILED` webhook events).
 *
 * `cart_id`/`broadcast_id` are nullable and unused until broadcast and attribution (broadcast sending,
 * cart-save-rate and revenue attribution) — added now so those phases need no further migration on
 * this table, matching this plugin's own precedent of sizing a table for its full known scope up
 * front (see `consent_record`'s indexes, sized for both the customer- and phone-scoped lookups from
 * day one).
 */
const MessageLog = model
	.define("message_log", {
		id: model.id().primaryKey(),
		external_id: model.text(),
		phone_number: model.text(),
		customer_id: model.text().nullable(),
		purpose: model.enum(["marketing", "cart_recovery", "ai_reply", "transactional"]),
		cart_id: model.text().nullable(),
		broadcast_id: model.text().nullable(),
		segment_count: model.number().nullable(),
		status: model.enum(["sent", "delivered", "failed"]),
		sent_at: model.dateTime(),
		delivered_at: model.dateTime().nullable(),
		failed_at: model.dateTime().nullable(),
		failure_reason: model.text().nullable(),
		// Attribution: set once, by `subscribers/order-attribution.ts`, when an
		// `order.placed` event lands within the attribution window of this send — a `cart_recovery`
		// row via `cart_id`, a `marketing` row via `customer_id`. The write is guarded two ways: the
		// claimed row's own `converted_order_id IS NULL` (one row credits at most one order), AND a
		// `NOT EXISTS` check that no OTHER row already carries this same order id for this purpose
		// (one order credits at most one row per purpose) — the second guard is what makes a
		// redelivered/retried `order.placed` event idempotent; see that subscriber's own JSDoc for
		// the double-credit this closes.
		converted_order_id: model.text().nullable(),
		// The linked order's total at the moment of attribution, in integer minor-unit cents (e.g.
		// `1999` for $19.99) — NOT the store-currency major-unit float an earlier version of this
		// column used. `model.float()` maps to Postgres `real` (float4, 24-bit mantissa): exact only
		// up to roughly $41,943 at cent precision, silently rounded above that, and unrecoverable
		// afterward since this is a denormalized snapshot with no live order reference. Integer cents matches this plugin's own `sms_cost_per_segment_cents` convention and
		// has no such ceiling in any realistic order-total range.
		converted_amount_cents: model.number().nullable(),
	})
	.indexes([
		// recordDelivery's lookup, on every DLR webhook call.
		{ on: ["external_id"] },
		// getDeliverySummary's purpose-filtered "sent" count (purpose + optional sent_at range).
		{ on: ["purpose", "sent_at"] },
		// getDeliverySummary's unfiltered "sent" count, and its default-bounded date range.
		{ on: ["sent_at"] },
		// getDeliverySummary's delivered/failed counts — every call filters on status, so this needs
		// its own index rather than relying on the purpose/sent_at ones above, which don't cover it.
		{ on: ["status", "sent_at"] },
		// order-attribution's cart-save-rate match: latest unconverted `cart_recovery` row for a
		// given cart, within the attribution window.
		{ on: ["cart_id"] },
		// order-attribution's revenue-attribution match: latest unconverted `marketing` row for a
		// given customer, within the attribution window.
		{ on: ["customer_id", "purpose", "sent_at"] },
		// order-attribution's per-order idempotency guard (`NOT EXISTS ... WHERE converted_order_id
		// = ?`), run on every `order.placed` event — without this, that check is a sequential scan.
		{ on: ["converted_order_id"] },
	]);

export default MessageLog;
