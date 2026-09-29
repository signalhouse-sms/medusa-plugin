import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260905230000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "broadcast" ("id" text not null, "message_body" text not null, "status" text check ("status" in ('draft', 'scheduled', 'sending', 'sent')) not null, "customer_group_id" text null, "scheduled_at" timestamptz null, "sent_at" timestamptz null, "recipient_count" int not null, "sent_count" int not null, "failed_count" int not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "broadcast_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_broadcast_deleted_at" ON "broadcast" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_broadcast_status_scheduled_at" ON "broadcast" ("status", "scheduled_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "broadcast_recipient" ("id" text not null, "broadcast_id" text not null, "customer_id" text null, "phone_number" text not null, "status" text check ("status" in ('pending', 'sending', 'sent', 'failed')) not null, "attempts" int not null, "failure_reason" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "broadcast_recipient_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_broadcast_recipient_deleted_at" ON "broadcast_recipient" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_broadcast_recipient_broadcast_id_status_created_at" ON "broadcast_recipient" ("broadcast_id", "status", "created_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "broadcast_recipient" cascade;`);
    this.addSql(`drop table if exists "broadcast" cascade;`);
  }

}
