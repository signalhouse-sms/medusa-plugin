import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Covers `MessageLogModuleService.findBroadcastSend`'s `(broadcast_id, phone_number)` lookup
 * (the `broadcast` module's resend-prevention guard) — none of this table's
 * existing indexes (external_id, purpose+sent_at, sent_at, status+sent_at) cover that shape.
 * Lives in THIS module's own migrations directory, not `broadcast`'s, even though `broadcast` is
 * what needs it — Medusa tracks each module's migrations independently, so a cross-module `CREATE
 * INDEX` from another module's migration file has no guaranteed ordering against this table's own
 * creation.
 */
export class Migration20260906050000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_message_log_broadcast_id_phone_number" ON "message_log" ("broadcast_id", "phone_number") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_message_log_broadcast_id_phone_number";`);
  }

}
