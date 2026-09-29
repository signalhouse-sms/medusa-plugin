import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 7;

/**
 * Credits a placed order to the SMS(es) that plausibly drove it, within a configurable attribution
 * window (`SIGNALHOUSE_ATTRIBUTION_WINDOW_DAYS`, default 7 — same env-var convention as
 * `SIGNALHOUSE_CART_ABANDONMENT_THRESHOLD_MINUTES`). A **separate** subscriber from
 * `order-placed.ts` deliberately — that one sends the order-confirmation SMS; this one only does
 * read-then-write bookkeeping against `message_log`. Neither should be able to affect the other:
 * a bug in attribution must never block or delay the confirmation send, and a confirmation-SMS
 * failure must never skip attribution. Medusa's event bus supports any number of subscribers per
 * event, so this needs no coordination with that file beyond listening to the same event.
 *
 * The window is anchored to the ORDER's own `created_at`, not to `Date.now()` at handler execution
 * — `order.placed` can be delivered late or redelivered, and anchoring to wall-clock-at-execution
 * both admits a `marketing` send that went out *after* the order (which should never be causal) and
 * can drop a genuinely-causal send that happened 7 days before the order once processing is merely
 * delayed (ai-review, PR #1321). Both SQL queries below therefore bound `sent_at` on both sides:
 * `>= orderCreatedAt - windowDays` and `<= orderCreatedAt`.
 *
 * Two independent, non-exclusive matches:
 * - **Cart-save rate**: if the order's cart matches a `cart_recovery` `message_log` row (by
 *   `cart_id`) sent within the window, that row is credited. A cart that received several recovery
 *   attempts (`jobs/cart-abandonment.ts` retries up to its own `MAX_SEND_ATTEMPTS`) credits its
 *   single most recent qualifying send — the one plausibly still fresh in the recipient's mind.
 * - **Revenue attribution**: if the order's customer matches a `marketing` `message_log` row (by
 *   `customer_id`) sent within the window, that row is credited — "the most recent broadcast this
 *   customer received," per the attribution feature's scope. **This will rarely match anything today**: the
 *   broadcast module's audience resolution keys off `consent_record` (`resolve-broadcast-audience.ts`),
 *   and every real consent grant today comes from a customer-less JOIN-keyword reply, so
 *   `message_log.customer_id` is null on nearly every `marketing` row that exists right now (the
 *   same architectural fact documented on that file). This is a real, honest gap — not silently
 *   worked around with a phone-number fallback, since a shared/reassigned number would then credit
 *   the wrong customer's order to a stranger's broadcast. It closes itself as soon as a consent
 *   path populates `customer_id` on the grant, with no change needed here.
 *
 * Both matches use the same shape: an atomic `UPDATE ... WHERE id = (SELECT ... FOR UPDATE)`, not a
 * separate read-then-write, guarded TWO ways:
 * 1. The claimed row's own `converted_order_id IS NULL` — one row credits at most one order.
 * 2. A `NOT EXISTS` check that no OTHER row already carries this same order id for this purpose —
 *    one order credits at most one row per purpose. This second guard is the one that matters for
 *    idempotency: `order.placed` has no dedup guarantee here (this handler has no idempotency key
 *    and no try/catch — a mid-handler throw or a genuine redelivery re-runs both blocks from
 *    scratch), and guard (1) alone only stops two *different* orders from racing for the *same*
 *    row. Without guard (2), a customer who received two marketing sends in-window and then placed
 *    one order would have that order credited twice — once per redelivery — inflating
 *    `revenueAttributed` by the order's full amount per extra delivery (ai-review, PR #1321). The
 *    inner `SELECT ... FOR UPDATE` (no `SKIP LOCKED` — this fires per-order, not as a batch claim,
 *    so blocking briefly on a genuine conflict is correct, not a throughput concern) locks the
 *    single latest-eligible row; a second, concurrent UPDATE targeting the same row re-evaluates
 *    both guards after the first commits and finds nothing left to claim.
 *
 * A conversion is credited only once per order per purpose, and this subscriber never looks at
 * `converted_order_id` beyond using it as the write guard.
 * @async
 * @param {SubscriberArgs<{id: string}>} args - The order.placed event, carrying the order id.
 */
export default async function orderAttributionHandler({ event: { data }, container }: SubscriberArgs<{ id: string }>) {
	const query = container.resolve(ContainerRegistrationKeys.QUERY);
	const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
	const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

	const {
		data: [order],
	} = await query.graph({
		entity: "order",
		fields: ["id", "created_at", "total", "cart.id", "customer.id"],
		filters: { id: data.id },
	});

	if (!order) {
		logger.info(`signalhouse-sms: order-attribution found no order for ${data.id}, skipping`);
		return;
	}

	// Cents, not the store-currency major unit — see `converted_amount_cents`'s own JSDoc on the
	// model for why a float column was the wrong choice here.
	const amountCents = Math.round(Number(order.total) * 100);
	const windowDays = Number(process.env.SIGNALHOUSE_ATTRIBUTION_WINDOW_DAYS) || DEFAULT_ATTRIBUTION_WINDOW_DAYS;
	const orderPlacedAt = new Date(order.created_at);
	const windowStart = new Date(orderPlacedAt.getTime() - windowDays * 24 * 60 * 60 * 1000);

	if (order.cart?.id) {
		const { rowCount } = await pgConnection.raw(
			`update message_log
			 set converted_order_id = ?, converted_amount_cents = ?
			 where id = (
			   select id from message_log
			   where cart_id = ? and purpose = 'cart_recovery' and converted_order_id is null
			     and sent_at >= ? and sent_at <= ? and deleted_at is null
			     and not exists (
			       select 1 from message_log already
			       where already.converted_order_id = ? and already.purpose = 'cart_recovery'
			         and already.deleted_at is null
			     )
			   order by sent_at desc
			   limit 1
			   for update
			 )`,
			[order.id, amountCents, order.cart.id, windowStart.toISOString(), orderPlacedAt.toISOString(), order.id],
		);
		if (rowCount > 0) {
			logger.info(`signalhouse-sms: order ${order.id} attributed to cart ${order.cart.id}'s recovery SMS`);
		}
	}

	if (order.customer?.id) {
		const { rowCount } = await pgConnection.raw(
			`update message_log
			 set converted_order_id = ?, converted_amount_cents = ?
			 where id = (
			   select id from message_log
			   where customer_id = ? and purpose = 'marketing' and converted_order_id is null
			     and sent_at >= ? and sent_at <= ? and deleted_at is null
			     and not exists (
			       select 1 from message_log already
			       where already.converted_order_id = ? and already.purpose = 'marketing'
			         and already.deleted_at is null
			     )
			   order by sent_at desc
			   limit 1
			   for update
			 )`,
			[order.id, amountCents, order.customer.id, windowStart.toISOString(), orderPlacedAt.toISOString(), order.id],
		);
		if (rowCount > 0) {
			logger.info(`signalhouse-sms: order ${order.id} attributed to customer ${order.customer.id}'s most recent broadcast`);
		}
	}
}

export const config: SubscriberConfig = {
	event: "order.placed",
};
