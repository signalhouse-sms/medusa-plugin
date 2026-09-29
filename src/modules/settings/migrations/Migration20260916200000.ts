import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Cart abandonment: per-job state so the cart-abandonment job only picks up carts that went stale after
 * it was switched on, instead of the whole 7-day backlog on its first run.
 */
export class Migration20260916200000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "signalhouse_job_state" ("id" text not null, "name" text not null, "active_since" timestamptz not null, "last_tick_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "signalhouse_job_state_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_signalhouse_job_state_name_unique" ON "signalhouse_job_state" ("name") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_signalhouse_job_state_deleted_at" ON "signalhouse_job_state" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "signalhouse_job_state" cascade;`);
  }

}
