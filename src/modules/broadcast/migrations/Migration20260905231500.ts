import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * A covering index for `utils/sms.ts`'s `withStopFooter` scan against Medusa's CORE `notification`
 * table — it had no supporting index at all before this PR; it was only ever called once per
 * transactional/cart-recovery send, and `jobs/broadcast-send.ts` is this plugin's first
 * per-recipient-in-a-loop caller.
 *
 * This is the only cross-module index that belongs here: `notification` is a core Medusa table
 * that every provider (this plugin's own `signalhouse-sms` provider included) requires to exist
 * before it can register at all, unlike `consent_record`/`message_log` — those are OTHER PLUGIN
 * MODULES' own tables, each tracked by its own independent migration history with no guaranteed
 * ordering against this module's. Two migrations that mistakenly lived here for those tables
 * (ai-review, PR #1318, round 4 — directory-scan module registration order is not guaranteed to
 * put `broadcast`'s migrations after `sms-consent`'s/`message-log`'s, so `CREATE INDEX ... ON
 * "consent_record"`/`"message_log"` here could run before those tables exist on a fresh install
 * and abort this migration) now live in their owning modules instead:
 * `sms-consent/migrations/Migration20260906050000.ts` and
 * `message-log/migrations/Migration20260906050000.ts`.
 */
export class Migration20260905231500 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_notification_sms_success_to_last10" ON "notification" ((right(regexp_replace("to", '\\D', '', 'g'), 10))) WHERE channel = 'sms' AND status = 'success';`);
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_notification_sms_success_to_last10";`);
  }

}
