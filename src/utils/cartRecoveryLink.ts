/**
 * Builds the cart-recovery URL sent in a recovery SMS. Uses `URL`/`URLSearchParams` rather than a
 * hand-built template literal — a merchant's `SIGNALHOUSE_CART_RECOVERY_URL_BASE` may already carry
 * its own query string (a UTM-tagged link, say), and naive concatenation would silently produce a
 * broken double-`?`. There is deliberately no signed/expiring token here: Medusa's own public
 * Store API (`GET`/`POST /store/carts/:id`) requires no `authenticate()` — a bare cart id is already
 * the same trust boundary a storefront's own cart-id cookie relies on, so wrapping it in a signed
 * token would be security theater on top of a boundary Medusa itself doesn't enforce.
 * @param {string} baseUrl - The merchant-configured recovery page URL (may already have a query string).
 * @param {string} cartId - The cart's id.
 * @returns {string} The recovery URL with `cart_id` appended.
 */
export function buildCartRecoveryUrl(baseUrl: string, cartId: string): string {
	const url = new URL(baseUrl);
	url.searchParams.set("cart_id", cartId);
	return url.toString();
}
