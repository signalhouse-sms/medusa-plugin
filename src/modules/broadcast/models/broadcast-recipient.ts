import { model } from "@medusajs/framework/utils";

/**
 * One resolved recipient of a `broadcast`, tracked from `pending` through `sending` (claimed by a
 * `jobs/broadcast-send.ts` tick, via `SELECT ... FOR UPDATE SKIP LOCKED`, so two overlapping ticks
 * never claim the same row) to a terminal `sent`/`failed`. A transient send failure reverts a
 * `sending` row back to `pending` with `attempts` incremented, so the next tick retries it — capped
 * at `MAX_SEND_ATTEMPTS` in the job, the same bounded-retry shape `jobs/cart-abandonment.ts` already
 * uses. `broadcast_id` is a plain indexed foreign key, not a DML relation — the same flat-FK
 * convention `message_log` already uses for its own `cart_id`/`broadcast_id` columns, so this table
 * needs no relation config this plugin hasn't exercised (and hand-verified in a migration) anywhere
 * else yet.
 */
const BroadcastRecipient = model
	.define("broadcast_recipient", {
		id: model.id().primaryKey(),
		broadcast_id: model.text(),
		customer_id: model.text().nullable(),
		phone_number: model.text(),
		status: model.enum(["pending", "sending", "sent", "failed"]),
		attempts: model.number(),
		failure_reason: model.text().nullable(),
	})
	.indexes([
		// jobs/broadcast-send.ts's per-broadcast pending-batch drain.
		{ on: ["broadcast_id", "status"] },
	]);

export default BroadcastRecipient;
