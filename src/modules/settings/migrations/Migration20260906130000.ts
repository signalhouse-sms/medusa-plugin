import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Attribution analytics: adds the merchant-set cost-per-segment figure the attribution analytics' ROI
 * calculation divides by — see the model's own JSDoc for why this lives on `account_link` rather
 * than a new table.
 */
export class Migration20260906130000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE "account_link" ADD COLUMN IF NOT EXISTS "sms_cost_per_segment_cents" int null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "account_link" DROP COLUMN IF EXISTS "sms_cost_per_segment_cents";`);
  }

}
