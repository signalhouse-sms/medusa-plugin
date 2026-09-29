# Consent implementation guide

Unlike a hosted-checkout platform (Shopify, say), Medusa has no built-in signal that says "this
customer consented to SMS." **Your storefront's own frontend has to call this plugin's consent
route directly.** This is the one piece of real integration work an install of this plugin needs
from you — everything else (delivery tracking, opt-out handling, the STOP footer) works without any
storefront changes.

## The two halves of consent, and why they're separate

1. **Prompting** (`POST /store/sms-consent/join-prompt`) — your checkout UI calls this with a cart
   id. It resolves that cart's phone number server-side and sends a "Reply JOIN to confirm" SMS to
   it. **It does not grant consent.** This route is reachable by any anonymous browser holding your
   storefront's publishable key, so it can only ever cause an SMS to go out — never mark a number as
   consented on its own.
2. **Granting** (fully automatic, no integration needed) — consent is only ever granted when that
   phone number's own owner replies **JOIN** to the confirmation text. This is the plugin's
   `webhooks/signalhouse` route, driven by Signal House's signed `MESSAGE_RECEIVED` webhook (see step 6 of
   [INSTALLATION.md](./INSTALLATION.md) for the webhook setup).

This split exists because a `cart_id` alone doesn't prove the browser calling your checkout holds
the phone in `shipping_address.phone` — that field is free-text checkout input like any other. The
real proof is a reply from that number's own phone, which only the carrier can confirm.

## What you need to build: a consent checkbox

Add a checkbox to your checkout flow that calls the prompt route when checked. Next.js example:

```tsx
// components/SmsConsentCheckbox.tsx
"use client"
import { useState } from "react"

export function SmsConsentCheckbox({ cartId }: { cartId: string }) {
  const [checked, setChecked] = useState(false)
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle")

  async function handleChange(next: boolean) {
    setChecked(next)
    if (!next || !cartId) return
    const res = await fetch(`${process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL}/store/sms-consent/join-prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY!,
      },
      body: JSON.stringify({ cart_id: cartId }),
    })
    setStatus(res.ok || res.status === 429 ? "sent" : "error")
  }

  return (
    <label>
      <input type="checkbox" checked={checked} onChange={(e) => handleChange(e.target.checked)} />
      Text me order updates. Msg&data rates may apply.
      {status === "sent" && <p>We've texted you — reply JOIN to confirm.</p>}
    </label>
  )
}
```

A `429` from this route means the phone number already has a claim in flight (rate-limited to one
prompt per number per hour) — treat it the same as a success in your UI, since a prompt has already
gone out to that number recently.

## What a JOIN reply actually grants

A single JOIN reply grants **all four** consent purposes for that phone number at once —
`marketing`, `cart_recovery`, `ai_reply`, and `transactional` — not just whatever your checkbox
copy implied. This is deliberate: a JOIN reply is at least as strong a signal as anything else this
module accepts, and your checkbox promising "order updates" wouldn't otherwise unlock the
`transactional` sends (order/shipment confirmations) that deliver on that promise.

## Opting back out

**Fully automatic, no integration needed.** A reply of `STOP`, `STOPALL`, `STOP ALL`, `QUIT`, `END`,
`REVOKE`, `OPTOUT`, `OPT OUT`, `OPT-OUT`, `CANCEL`, or `UNSUBSCRIBE` (any casing/punctuation) to
*any* message from your Signal House number revokes every active consent grant for that phone
number. You don't need to build anything for this — it's the platform's own mandatory keyword floor,
enforced by this plugin's webhook handler regardless of what triggered the original text.

## Checking eligibility yourself

If you're calling `notificationModuleService.createNotifications` from your own custom code (rather
than relying on this plugin's own send sites), check eligibility first:

```ts
const eligibility = await consentService.checkEligibility(customerId, phoneNumber, "marketing")
if (!eligibility.eligible) {
  // eligibility.reason is "no_consent_record" or "revoked"
}
```

For a guest/anonymous phone number with no Medusa customer, use `checkEligibilityByPhone(phoneNumber, purpose)`
instead. See **`no record` means `not eligible`** — this module has no legacy opted-in fallback;
silence is never treated as consent.
