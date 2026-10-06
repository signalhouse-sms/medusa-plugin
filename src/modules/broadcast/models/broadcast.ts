import { model } from "@medusajs/framework/utils";

/**
 * One marketing SMS broadcast: a message body sent to every currently marketing-consented
 * customer, optionally scoped to a native Medusa customer group (`customer_group_id` — null means
 * "everyone"). The audience is resolved once, at creation time (`workflows/create-broadcast.ts`),
 * not re-resolved at send time — `recipient_count`/`sent_count`/`failed_count` reflect that
 * snapshot, and `jobs/broadcast-send.ts` drains the `broadcast_recipient` rows it created,
 * re-checking each recipient's consent immediately before actually sending (a broadcast can sit
 * `scheduled` for days; consent can be revoked in that window).
 *
 * `status: "draft"` is defined but unused until the admin UI adds a save-without-sending
 * flow — every broadcast created by `POST /admin/signalhouse/broadcasts` today goes straight to
 * `scheduled`, `sending`, or (a zero-recipient audience) `sent`.
 */
const Broadcast = model
	.define("broadcast", {
		id: model.id().primaryKey(),
		message_body: model.text(),
		status: model.enum(["draft", "scheduled", "sending", "sent"]),
		customer_group_id: model.text().nullable(),
		scheduled_at: model.dateTime().nullable(),
		sent_at: model.dateTime().nullable(),
		recipient_count: model.number(),
		sent_count: model.number(),
		failed_count: model.number(),
	})
	.indexes([
		// jobs/broadcast-send.ts's due-broadcast scan: status='scheduled' AND scheduled_at <= now,
		// plus any status='sending' left over from an interrupted prior run.
		{ on: ["status", "scheduled_at"] },
	]);

export default Broadcast;
