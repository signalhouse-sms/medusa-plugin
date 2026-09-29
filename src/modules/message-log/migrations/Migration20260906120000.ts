import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Attribution: adds `converted_order_id`/`converted_amount_cents` for
 * cart-save-rate and revenue-attribution bookkeeping, plus the lookup shapes
 * `subscribers/order-attribution.ts` needs — `cart_id` alone (cart-recovery match),
 * `(customer_id, purpose, sent_at)` (marketing match, latest-first), and `converted_order_id` alone
 * (the per-order idempotency guard, checked on every `order.placed` event) — none of which the
 * table's existing indexes cover.
 *
 * `converted_amount_cents` is `int`, not `real` — an earlier version of this migration used
 * `model.float()` (Postgres `real`, float4), which silently loses cent-level precision above
 * roughly $41,943 with no way to recover the true value afterward (ai-review, PR #1321). Amended in
 * place rather than added as a follow-up migration since this PR was never merged with the `real`
 * column live anywhere.
 */
export class Migration20260906120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE "message_log" ADD COLUMN IF NOT EXISTS "converted_order_id" text null;`);
    this.addSql(`ALTER TABLE "message_log" ADD COLUMN IF NOT EXISTS "converted_amount_cents" int null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_message_log_cart_id" ON "message_log" ("cart_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_message_log_customer_id_purpose_sent_at" ON "message_log" ("customer_id", "purpose", "sent_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_message_log_converted_order_id" ON "message_log" ("converted_order_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_message_log_converted_order_id";`);
    this.addSql(`DROP INDEX IF EXISTS "IDX_message_log_customer_id_purpose_sent_at";`);
    this.addSql(`DROP INDEX IF EXISTS "IDX_message_log_cart_id";`);
    this.addSql(`ALTER TABLE "message_log" DROP COLUMN IF EXISTS "converted_amount_cents";`);
    this.addSql(`ALTER TABLE "message_log" DROP COLUMN IF EXISTS "converted_order_id";`);
  }

}
