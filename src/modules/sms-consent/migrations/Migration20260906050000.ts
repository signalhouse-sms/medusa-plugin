import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Covers `workflows/steps/resolve-broadcast-audience.ts`'s `WHERE purpose = ? ORDER BY
 * phone_number, granted_at DESC` scan (`broadcast` module) — none of this
 * table's existing indexes serve it, since `purpose` (the only equality filter) sits behind
 * `phone_number` (the column that needs ordering, with no equality filter of its own) in the
 * existing `(phone_number, purpose, granted_at)` index. Lives in THIS module's own migrations
 * directory, not `broadcast`'s, even though `broadcast` is what needs it — Medusa tracks each
 * module's migrations independently, so a cross-module `CREATE INDEX` from another module's
 * migration file has no guaranteed ordering against this table's own creation.
 */
export class Migration20260906050000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_consent_record_purpose_phone_number_granted_at" ON "consent_record" ("purpose", "phone_number", "granted_at" DESC) WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_consent_record_purpose_phone_number_granted_at";`);
  }

}
