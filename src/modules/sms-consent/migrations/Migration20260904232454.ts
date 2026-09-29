import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260904232454 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "consent_record" alter column "customer_id" type text using ("customer_id"::text);`);
    this.addSql(`alter table if exists "consent_record" alter column "customer_id" drop not null;`);
  }

  // Deliberately irreversible: guest-checkout consent (customer_id = null) is a
  // real, expected row shape once this ships, not an invalid state. Restoring NOT NULL here
  // would fail on any guest row that exists by then, and there's no non-destructive backfill for
  // "which customer does this guest consent belong to" — it doesn't belong to one. A rollback
  // that needs the old constraint back should migrate those rows deliberately first, not run
  // this automatically.
  override async down(): Promise<void> {}

}
