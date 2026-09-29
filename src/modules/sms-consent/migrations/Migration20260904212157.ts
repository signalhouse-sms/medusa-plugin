import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260904212157 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "consent_record" ("id" text not null, "customer_id" text not null, "phone_number" text not null, "purpose" text check ("purpose" in ('marketing', 'cart_recovery', 'ai_reply', 'transactional')) not null, "source" text not null, "granted_at" timestamptz not null, "revoked_at" timestamptz null, "revocation_method" text null, "consent_text" text null, "consent_version" text null, "ip_address" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "consent_record_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_consent_record_deleted_at" ON "consent_record" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_consent_record_customer_id_purpose_granted_at" ON "consent_record" ("customer_id", "purpose", "granted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_consent_record_customer_id_revoked_at" ON "consent_record" ("customer_id", "revoked_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_consent_record_phone_number_purpose" ON "consent_record" ("phone_number", "purpose") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "consent_record" cascade;`);
  }

}
