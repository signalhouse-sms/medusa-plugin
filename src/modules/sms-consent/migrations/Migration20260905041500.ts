import { Migration } from "@medusajs/framework/mikro-orm/migrations";

// A dedicated, general-purpose "claim" table, deliberately NOT the
// `notification` table: overloading `notification.status` to mean "an attempt was reserved" vs
// "actually delivered" reintroduces the exact ambiguity the cart job's "cooldown counts failed
// sends" fix (jobs/cart-abandonment.ts) already resolved for that table, and reusing
// `idempotency_key` for the same purpose hits a real @medusajs/notification bug on retry (see
// send-join-confirmation.ts's JSDoc) — this plugin has already been bitten by both. A small,
// single-purpose table sidesteps both traps entirely, and is shared by two independent claim
// kinds keyed by `claim_key`: `join-prompt/route.ts` claims a phone number for its per-number rate
// limit, and `send-join-confirmation.ts` claims a JOIN reply's `identifier` so a retried webhook
// delivery can't send a duplicate confirmation before the first attempt's send has even resolved.
// `status` ('pending' | 'succeeded' | 'failed') matters specifically for join-prompt's bounded
// retry logic: a 'pending' row (an attempt is currently in flight, outcome not yet known) must
// block a concurrent second request the same way a 'succeeded' row does — only a *settled*
// 'failed' row is safe to hand back out for another attempt. Tracking only `failed_attempts`
// without this distinction was tried and found broken by this card's own end-to-end verification:
// a concurrent second request saw an existing row with zero recorded failures and treated it as
// "safe, nothing pending here yet," sending a real duplicate.
export class Migration20260905041500 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "sms_consent_send_claim" (
        "id" text not null,
        "claim_key" text not null,
        "status" text not null default 'pending',
        "failed_attempts" integer not null default 0,
        "created_at" timestamptz not null default now(),
        constraint "sms_consent_send_claim_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      create index if not exists "IDX_send_claim_key_created"
      on "sms_consent_send_claim" ("claim_key", "created_at");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "sms_consent_send_claim";`);
  }

}
