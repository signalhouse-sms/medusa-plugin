# Installation guide

Step-by-step setup for `@signalhousellc/medusa-plugin` in your own Medusa backend.

## 1. Install the package

```bash
npm install @signalhousellc/medusa-plugin
```

Requires Medusa 2.19+ and Node 20.19+ or 22.12+.

## 2. Register the plugin and the notification provider

In your Medusa project's `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    "@signalhousellc/medusa-plugin",
  ],
  modules: [
    {
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: [
          {
            resolve: "@signalhousellc/medusa-plugin/providers/signalhouse-sms",
            id: "signalhouse-sms",
            options: {
              channels: ["sms"],
              apiKey: "<your Signal House API key>",
              senderPhoneNumber: "<your Signal House number or short code>",
              // baseUrl defaults to https://v2.signalhouse.io
            },
          },
        ],
      },
    },
  ],
})
```

`plugins` registers everything else this package ships: the `sms-consent`, `settings`,
`message-log`, and `broadcast` modules, the `order.placed`/`shipment.created`/`order-attribution`
subscribers, the cart-abandonment and broadcast-send scheduled jobs, the admin UI, and the storefront
consent/webhook routes. The notification provider is a separate, explicit step even though it lives
in the same package — Medusa never auto-registers providers.

## 3. Run migrations

```bash
npx medusa db:migrate
```

This creates every table this plugin owns (`consent_record`, `account_link`, `signalhouse_job_state`,
`message_log`, `broadcast`, `broadcast_recipient`, plus their indexes) and the `customer` ↔
`consent_record` module link. Nothing here touches core Medusa tables.

Re-run it after every plugin upgrade. New versions can add tables, and the cart-recovery job stops
sending until `signalhouse_job_state` exists.

## 4. Connect a Signal House account and register a brand

Open the Medusa admin — there's a new **Signal House** sidebar entry. Paste your Signal House API
key to connect (or create one at signalhouse.io first if you don't have an account yet), then fill
out the 10DLC brand registration form. Set `SIGNALHOUSE_SETTINGS_ENCRYPTION_KEY` (64 hex characters,
for example from `openssl rand -hex 32`) on the Medusa host first; it encrypts the stored API key,
and the admin only ever shows its last 4 characters. Brand status updates when you click
**Refresh status**.

**This is separate from the provider's own `apiKey` option in step 2.** Connecting an account in the
admin lets you register a brand and set the per-segment cost used for ROI — it does not change what number/key the
notification provider actually sends with. The provider still reads `apiKey`/`senderPhoneNumber`
from the static `medusa-config.ts` options above.

## 5. Wire up consent capture in your storefront

This is the one piece of real integration work — see [CONSENT_INTEGRATION.md](./CONSENT_INTEGRATION.md).
Unlike a hosted-checkout platform, Medusa has no built-in "this customer consented" signal, so your
storefront's own checkout UI has to call this plugin's consent route directly.

## 6. Register the Signal House webhook

JOIN/STOP replies and delivery tracking arrive as signed Signal House webhooks. Create a webhook
endpoint in Signal House (the portal's webhook settings, or `POST /webhook` on the API) with:

- `url`: `https://<your-medusa-backend>/webhooks/signalhouse`
- `subscribedEvents`: `MESSAGE_RECEIVED`, `MESSAGE_DELIVERED`, `MESSAGE_FAILED`

Set `SIGNALHOUSE_WEBHOOK_SIGNING_SECRET` on the Medusa host to that endpoint's signing secret. The
route rejects any request with a missing or wrong signature, or a timestamp more than 5 minutes
old.

## 7. Read the compliance checklist before enabling anything telemarketing-grade

`cart_recovery` sends and marketing broadcasts are both **disabled by default** — see
[COMPLIANCE_CHECKLIST.md](./COMPLIANCE_CHECKLIST.md) before setting
`SIGNALHOUSE_CART_ABANDONMENT_ENABLED` or `SIGNALHOUSE_MARKETING_BROADCAST_ENABLED` to `true`. Both
are off by default so you can plan send timing and consent for your own customers first.

## Environment variables reference

| Variable | Required for | Notes |
|---|---|---|
| `SIGNALHOUSE_API_BASE_URL` | Non-production account linking and shared API operations | Defaults to `https://v2.signalhouse.io`. If you change it, set the notification provider's `baseUrl` option to match. |
| `SIGNALHOUSE_SETTINGS_ENCRYPTION_KEY` | Connecting an account in the admin | 64 hex characters (32 bytes). Only checked the first time you connect an account. |
| `SIGNALHOUSE_WEBHOOK_SIGNING_SECRET` | JOIN/STOP keyword handling, delivery tracking | The signing secret of the webhook endpoint from step 6. |
| `SIGNALHOUSE_CART_ABANDONMENT_ENABLED` | Cart-recovery texts | `"true"` to enable. Off by default — read the compliance checklist first. Only carts that become abandoned after the job starts running are texted; carts already abandoned at that point are not. Off for more than 2 hours counts as a fresh start. |
| `SIGNALHOUSE_CART_ABANDONMENT_THRESHOLD_MINUTES` | Cart-recovery texts | Default 60. |
| `SIGNALHOUSE_CART_RECOVERY_URL_BASE` | Cart-recovery texts | Your storefront's recovery page. See [CART_RECOVERY_ROUTE.md](./CART_RECOVERY_ROUTE.md). Omit to send recovery texts with no link. |
| `SIGNALHOUSE_MARKETING_BROADCAST_ENABLED` | Broadcast sending | `"true"` to enable. Off by default — read the compliance checklist first. |
| `SIGNALHOUSE_ATTRIBUTION_WINDOW_DAYS` | Attribution analytics | Default 7. |
| `SIGNALHOUSE_PORTAL_URL` | Billing status link | Default `https://app2.signalhouse.io`. Where the admin's billing link points. Only needs changing on a non-production Signal House environment. |
