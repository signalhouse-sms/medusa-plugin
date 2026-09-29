import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260905220000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "message_log" ("id" text not null, "external_id" text not null, "phone_number" text not null, "customer_id" text null, "purpose" text check ("purpose" in ('marketing', 'cart_recovery', 'ai_reply', 'transactional')) not null, "cart_id" text null, "broadcast_id" text null, "segment_count" int null, "status" text check ("status" in ('sent', 'delivered', 'failed')) not null, "sent_at" timestamptz not null, "delivered_at" timestamptz null, "failed_at" timestamptz null, "failure_reason" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "message_log_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_message_log_deleted_at" ON "message_log" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_message_log_external_id" ON "message_log" ("external_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_message_log_purpose_sent_at" ON "message_log" ("purpose", "sent_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_message_log_sent_at" ON "message_log" ("sent_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_message_log_status_sent_at" ON "message_log" ("status", "sent_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "message_log" cascade;`);
  }

}
