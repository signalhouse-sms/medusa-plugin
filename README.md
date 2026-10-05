# Signal House for Medusa

SMS for [Medusa](https://medusajs.com) stores, powered by [Signal House](https://signalhouse.io).
Install one package into your Medusa backend and your store can send order and shipping texts,
recover abandoned carts, run marketing broadcasts, and track delivery and revenue, all from the
Medusa admin.

- **Transactional SMS.** Order confirmations and shipping updates, sent through Medusa's own
  Notification module as an `sms` provider.
- **Cart recovery.** A text for abandoned carts, with a link straight back to the cart.
- **Consent built in.** Customers opt in by replying JOIN and opt out by replying STOP. Nothing
  sends without a consent record.
- **Marketing broadcasts.** Send to every opted-in customer, or to one Medusa customer group.
- **Admin pages.** Connect your Signal House account, register your 10DLC brand, compose
  broadcasts, and see delivery, cart-save, and revenue analytics.

Requires Medusa 2.19+ and Node 20.19+ or 22.12+, plus a [Signal House](https://signalhouse.io)
account and API key.

## Quick start

**1. Install**

```bash
npm install @signalhouse-sms/medusa-plugin
```

**2. Register the plugin and the SMS provider** in `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: ["@signalhouse-sms/medusa-plugin"],
  modules: [
    {
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: [
          {
            resolve: "@signalhouse-sms/medusa-plugin/providers/signalhouse-sms",
            id: "signalhouse-sms",
            options: {
              channels: ["sms"],
              apiKey: "<your Signal House API key>",
              senderPhoneNumber: "<your Signal House number>",
            },
          },
        ],
      },
    },
  ],
})
```

**3. Run migrations**

```bash
npx medusa db:migrate
```

Run this again after every upgrade.

**4. Connect your account.** Open the Medusa admin and choose **Signal House** in the sidebar.
Paste your API key, then fill in the 10DLC brand registration form.

**5. Add an SMS opt-in checkbox to checkout.** Your storefront calls
`POST /store/sms-consent/join-prompt` with the cart id; the customer gets a "Reply JOIN to confirm"
text, and their reply is what opts them in. A ready-made Next.js checkbox is in the
[consent guide](https://unpkg.com/@signalhouse-sms/medusa-plugin/docs/CONSENT_INTEGRATION.md).

**6. Receive replies and delivery updates.** In Signal House, create a webhook endpoint pointing to
`https://<your-medusa-backend>/webhooks/signalhouse`, subscribed to `MESSAGE_RECEIVED`,
`MESSAGE_DELIVERED`, and `MESSAGE_FAILED`. Set its signing secret as
`SIGNALHOUSE_WEBHOOK_SIGNING_SECRET` on your Medusa host.

Order and shipping texts work as soon as a customer has opted in. Cart recovery and broadcasts stay
off until you turn them on (see below).

## Provider options

| Option | Required | Description |
| --- | --- | --- |
| `apiKey` | Yes | Signal House API key used to send messages. |
| `senderPhoneNumber` | Yes | Default sending number. A notification that carries its own `from` overrides it. |
| `baseUrl` | No | Signal House API URL. Defaults to `https://v2.signalhouse.io`. |

## Environment variables

Set these on your Medusa host.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SIGNALHOUSE_SETTINGS_ENCRYPTION_KEY` | none | 64 hex characters (for example `openssl rand -hex 32`). Encrypts the API key stored by the admin page. Needed before you connect an account. |
| `SIGNALHOUSE_WEBHOOK_SIGNING_SECRET` | none | Verifies Signal House webhooks for JOIN/STOP replies and delivery tracking. |
| `SIGNALHOUSE_CART_ABANDONMENT_ENABLED` | `false` | Turns on cart recovery texts. |
| `SIGNALHOUSE_CART_ABANDONMENT_THRESHOLD_MINUTES` | `60` | How long a cart sits before it counts as abandoned. |
| `SIGNALHOUSE_CART_RECOVERY_URL_BASE` | none | Your storefront's cart recovery page. Without it, recovery texts go out with no link. |
| `SIGNALHOUSE_MARKETING_BROADCAST_ENABLED` | `false` | Turns on broadcast sending. |
| `SIGNALHOUSE_ATTRIBUTION_WINDOW_DAYS` | `7` | How long after a text an order is credited to it. |
| `SIGNALHOUSE_API_BASE_URL` | `https://v2.signalhouse.io` | Change only for a non-production Signal House environment. |
| `SIGNALHOUSE_PORTAL_URL` | `https://app2.signalhouse.io` | Where the admin's billing link points. |

## Cart recovery and broadcasts

Both ship turned off so each store decides when to send. Before turning them on, read the
[compliance checklist](https://unpkg.com/@signalhouse-sms/medusa-plugin/docs/COMPLIANCE_CHECKLIST.md).
The main thing to plan for is send timing: keep these texts between 8am and 9pm in your customers'
local time.

- **Cart recovery** checks every 15 minutes and sends at most one text per phone number per 24
  hours. Only carts abandoned after you turn it on are texted, so enabling it never messages last
  week's carts. The [cart recovery route guide](https://unpkg.com/@signalhouse-sms/medusa-plugin/docs/CART_RECOVERY_ROUTE.md)
  has a Next.js route for the link.
- **Broadcasts** are composed in the admin under **SH Broadcasts**, sent to every opted-in customer
  or one customer group, and can be scheduled. Consent is re-checked right before each send.

## Consent and compliance

- Consent is granted only when the phone's owner replies JOIN, and it covers marketing, cart
  recovery, and transactional texts.
- STOP, END, QUIT, CANCEL, UNSUBSCRIBE and similar replies opt the number out of everything.
- "Reply STOP to opt out." is added to the first text a number receives from your store.
- A confirmation text is sent automatically when someone replies JOIN.

## Billing

The plugin is free. Messages bill to your Signal House wallet like any other Signal House usage,
and the admin page shows your plan and wallet status with a link to manage billing.

## Guides

The full guides ship with the package in `node_modules/@signalhouse-sms/medusa-plugin/docs/`:

- [Installation](https://unpkg.com/@signalhouse-sms/medusa-plugin/docs/INSTALLATION.md)
- [Consent integration](https://unpkg.com/@signalhouse-sms/medusa-plugin/docs/CONSENT_INTEGRATION.md)
- [Compliance checklist](https://unpkg.com/@signalhouse-sms/medusa-plugin/docs/COMPLIANCE_CHECKLIST.md)
- [Cart recovery route](https://unpkg.com/@signalhouse-sms/medusa-plugin/docs/CART_RECOVERY_ROUTE.md)

## Support

Questions or issues: [signalhouse.io](https://signalhouse.io).

## License

MIT
