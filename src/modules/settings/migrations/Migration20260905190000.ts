import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260905190000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "account_link" ("id" text not null, "api_key_ciphertext" text not null, "api_key_last4" text not null, "group_id" text not null, "subgroup_id" text not null, "verified_at" timestamptz not null, "brand_id" text null, "brand_carrier_id" text null, "brand_status" text null, "brand_synced_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "account_link_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_account_link_deleted_at" ON "account_link" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "account_link" cascade;`);
  }

}
