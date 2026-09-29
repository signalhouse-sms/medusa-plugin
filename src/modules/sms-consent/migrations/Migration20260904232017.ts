import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260904232017 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`drop index if exists "IDX_consent_record_phone_number_purpose";`);

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_consent_record_phone_number_purpose_granted_at" ON "consent_record" ("phone_number", "purpose", "granted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_consent_record_phone_number_revoked_at" ON "consent_record" ("phone_number", "revoked_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_consent_record_phone_number_purpose_granted_at";`);
    this.addSql(`drop index if exists "IDX_consent_record_phone_number_revoked_at";`);

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_consent_record_phone_number_purpose" ON "consent_record" ("phone_number", "purpose") WHERE deleted_at IS NULL;`);
  }

}
