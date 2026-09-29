# TCPA/CTIA compliance checklist

This plugin ports Signal House's own SMS compliance model, and automates most of it. This checklist
tells you plainly what's handled for you, and — just as importantly — what isn't, so you don't
assume automation that doesn't exist. Read this before enabling `cart_recovery` sends or marketing
broadcasts specifically; both stay off by default because of the gaps below, not by accident.

## Handled automatically — no action needed

- ✅ **STOP keyword floor.** Any reply of `stop`, `stopall`, `stop all`, `quit`, `end`, `revoke`,
  `optout`, `opt out`, `opt-out`, `cancel`, or `unsubscribe` (any casing/punctuation, whole-message
  match) to any message from your number revokes every active consent grant for that phone number.
- ✅ **CTIA welcome/confirmation SMS on JOIN.** A JOIN reply triggers the mandatory confirmation
  text automatically.
- ✅ **STOP footer on a genuinely first message.** `Reply STOP to opt out.` is appended
  automatically, but *only* on the first successfully-delivered SMS a phone number has ever received
  from your store, and only when the message doesn't already mention "stop" — required on a first
  message, not repeated on every send (repeating it on every message trains recipients to ignore it).
- ✅ **No unconditional sends, ever, for any purpose — including transactional.** Every send path in
  this plugin checks consent first. There is no purpose that bypasses this, order/shipment
  confirmations included.
- ✅ **Anti-harassment rate limiting on the consent-prompt route.** One prompt per phone number per
  hour, so an anonymous checkout endpoint can't be looped into spamming a number with join prompts.
- ✅ **Signed, replay-protected inbound webhook.** JOIN/STOP processing only trusts a signature-
  verified `MESSAGE_RECEIVED` webhook with a timestamp less than 5 minutes old.

## Your responsibility — not enforced by this plugin yet

- ⚠️ **Express-written-consent source restriction is not enforced.** Signal House's compliance model
  restricts `marketing` and `cart_recovery` specifically to an allow-list of
  *express-written* consent sources. Today, `checkEligibility`/`checkEligibilityByPhone` treat ANY
  existing, non-revoked consent record as sufficient for ANY purpose — the allow-list itself isn't
  checked. In practice this is narrower than it sounds: the only consent source this plugin
  currently writes is a JOIN-keyword reply (`keyword_optin`), which genuinely is an accepted,
  compliant express-written source. But if you write your own consent-granting code (calling
  `grantConsent` directly, say, instead of going through the JOIN flow), nothing here stops you from
  granting `cart_recovery`/`marketing` consent from a source that wouldn't actually qualify. Don't
  build a consent-capture path that skips the real JOIN confirmation loop.
- ⚠️ **No quiet-hours (8am–9pm recipient local time) gate.** TCPA restricts telemarketing-grade sends
  to daytime hours in the recipient's own timezone. Neither `cart_recovery` sends
  (`jobs/cart-abandonment.ts`) nor marketing broadcasts (`jobs/broadcast-send.ts`) implement this —
  both send at whatever time their schedule fires, with no timezone signal at all. **This is the
  primary reason both are disabled by default.** A coarse approximation (guessing timezone from
  country/region) was deliberately not built, because getting it subtly wrong reads as "handled"
  while still sending at 3am for real recipients — worse than an honest, visible gap. If you enable
  either of these, you are taking on responsibility for quiet-hours compliance yourself (e.g., by
  restricting your job schedule to hours safe for your actual customer base's timezone spread, or by
  building a real per-recipient timezone resolver).
- ⚠️ **10DLC brand/campaign registration and carrier approval.** Connecting a Signal House account
  and submitting a brand (admin UI) doesn't mean you're cleared to send at volume — carrier approval
  timelines and campaign-type restrictions are Signal House/TCR's process, not something this plugin
  controls or waits for.
- ⚠️ **Message content itself.** This plugin doesn't inspect or moderate what you put in a broadcast
  or transactional message body — content compliance (no prohibited categories, accurate business
  identification, honest opt-out instructions beyond the automated footer) is on you.

## Before you flip `SIGNALHOUSE_CART_ABANDONMENT_ENABLED` or `SIGNALHOUSE_MARKETING_BROADCAST_ENABLED` to `true`

1. Confirm your consent-capture path is the real JOIN flow (see
   [CONSENT_INTEGRATION.md](./CONSENT_INTEGRATION.md)), not a shortcut that grants consent from an
   unverified source.
2. Have an actual plan for quiet hours — even a manual one (e.g., only running the job during a
   schedule window that's safe for your customer base) beats none.
3. Confirm your Signal House brand/campaign is actually carrier-approved for the volume and use case
   you're about to send at.
