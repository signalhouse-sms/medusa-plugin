# Cart-recovery route snippet

`jobs/cart-abandonment.ts` sends a recovery SMS containing a link built by
`buildCartRecoveryUrl(SIGNALHOUSE_CART_RECOVERY_URL_BASE, cartId)` — your
`SIGNALHOUSE_CART_RECOVERY_URL_BASE` with a `cart_id` query parameter appended (merged correctly
even if your base URL already has its own query string, e.g. UTM tags). If you don't set that env
var, recovery texts still send — they just omit the link entirely, so this isn't required to use
the feature, only to make the link actually useful.

**This plugin has no opinion on storefront routing** — you wire up the receiving end. There's
deliberately no signed or expiring token wrapping the cart id: Medusa's own public Store API
(`GET`/`POST /store/carts/:id`) requires no customer authentication, just a store-level publishable
key, which is already the same trust boundary your storefront's ordinary cart-id cookie relies on.
Wrapping it in a signed token would be security theater on top of a boundary Medusa itself doesn't
enforce.

## Example: Next.js (App Router)

Mirrors the cookie convention Medusa's own official starter (`dtc-starter`, and its now-deprecated
predecessor `nextjs-starter-medusa`) uses in `src/lib/data/cookies.ts`'s `setCartId`, so the rest of
a storefront built on that starter picks up the restored cart with no further changes:

```ts
// app/cart-recover/route.ts
import { NextRequest, NextResponse } from "next/server"
import Medusa from "@medusajs/js-sdk"

const sdk = new Medusa({ baseUrl: process.env.MEDUSA_BACKEND_URL!, publishableKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY! })

export async function GET(request: NextRequest) {
  const cartId = request.nextUrl.searchParams.get("cart_id")
  if (!cartId) {
    return NextResponse.redirect(new URL("/", request.url))
  }

  // Confirm the cart still exists (and isn't already completed/deleted) before restoring it —
  // sdk.store.cart.retrieve throws on a missing cart.
  try {
    await sdk.store.cart.retrieve(cartId)
  } catch {
    return NextResponse.redirect(new URL("/", request.url))
  }

  const response = NextResponse.redirect(new URL("/cart", request.url))
  // Same shape as the starter's own setCartId (src/lib/data/cookies.ts) — the rest of the
  // storefront's existing cart logic picks this up with no further changes.
  response.cookies.set("_medusa_cart_id", cartId, {
    maxAge: 60 * 60 * 24 * 7,
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  })
  return response
}
```

If you're not on a storefront built from that starter, adapt the last step to however your own
storefront tracks the active cart — a different cookie name, a server-side session, or a client-side
store hydrated on load. The only hard requirement is reading `cart_id` off the query string and
resolving it via the Store API before redirecting into checkout.

## No built-in link expiry

A recovery link, once sent, works for as long as the cart exists — there's no built-in expiry.
`sdk.store.cart.retrieve` throwing (cart deleted, or a genuinely bad id) already sends the visitor
home instead of into a broken checkout, but a *completed* cart still resolves successfully. If you
need the link to stop working once a cart converts, check `cart.completed_at` yourself before
restoring it, rather than relying on the retrieve call to fail.
