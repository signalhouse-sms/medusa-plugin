import type { SignalHouseSDK } from "@signalhousellc/sdk";
import { unwrapSignalHouseResponse } from "./signalHouseClient";

type UserSubscription = { name: string; status: "ACTIVE" | "EXPIRED" | "PENDING_DOWNGRADE" };
type Wallet = { balance: number; reservedAmount?: number; currency: string; primaryPaymentMethodId: string | null };

/** Caps each outbound call so a hung upstream degrades into an error field, not a stuck page load. */
const BILLING_STATUS_TIMEOUT_MS = 5000;

export type BillingStatus = {
	subscription: { name: string; status: string } | null;
	subscriptionError?: string;
	wallet: { balanceMicrodollars: number; currency: string; hasPaymentMethod: boolean } | null;
	walletError?: string;
};

/**
 * Picks the subscription row that best represents "the plan this account is on right now" out of
 * `GET /subscription/user`'s array response — a group can have more than one non-expired row (the
 * `onlyActive` filter only excludes `EXPIRED`, not `PENDING_DOWNGRADE`), so this prefers a genuinely
 * `ACTIVE` row over a `PENDING_DOWNGRADE` one, and falls back to whatever's first if neither exists.
 * @param {UserSubscription[]} subscriptions - The account's non-expired subscription rows.
 * @returns {UserSubscription | null} The best-representative row, or null if the array is empty.
 */
function pickCurrentSubscription(subscriptions: UserSubscription[]): UserSubscription | null {
	if (subscriptions.length === 0) return null;
	return subscriptions.find((s) => s.status === "ACTIVE") ?? subscriptions[0];
}

/**
 * Reads a linked Signal House account's subscription and wallet status, for the admin settings
 * page's billing-visibility section. Takes an already-built client rather than a raw
 * API key so this is directly unit-testable with a stub client, and so callers control exactly when
 * the (encrypted-at-rest, decrypt-on-demand) API key gets decrypted.
 *
 * The subscription and wallet reads are independent `Promise.allSettled` calls with their own error
 * fields (`subscriptionError`/`walletError`), not one combined error — a caller needs to tell "this
 * account genuinely has no plan" (`subscription: null`, no error) apart from "the read failed"
 * (`subscription: null`, `subscriptionError` set), since those two states call for opposite UI
 * treatment. Each call also carries an explicit timeout
 * (`SignalHouseSDK`'s underlying axios client has none by default), so a hung upstream surfaces as
 * an error field within {@link BILLING_STATUS_TIMEOUT_MS} instead of hanging the caller indefinitely.
 * @async
 * @param {SignalHouseSDK} client - A client already scoped to this account's API key.
 * @param {string} groupId - The linked account's Signal House group id.
 * @returns {Promise<BillingStatus>} The account's current subscription/wallet status. Either field
 *   is `null` (with its own `*Error` set) if its own call failed; the two are independent.
 */
export async function fetchBillingStatus(client: SignalHouseSDK, groupId: string): Promise<BillingStatus> {
	const [subscriptionResult, walletResult] = await Promise.allSettled([
		client.subscriptions.getSubscriptions({ groupId, onlyActive: true, options: { timeout: BILLING_STATUS_TIMEOUT_MS } }).then((response) =>
			pickCurrentSubscription(unwrapSignalHouseResponse<UserSubscription[]>(response, "Could not read subscription status")),
		),
		client.billing.getWallet({ groupId, options: { timeout: BILLING_STATUS_TIMEOUT_MS } }).then((response) =>
			unwrapSignalHouseResponse<Wallet>(response, "Could not read wallet status"),
		),
	]);

	const current = subscriptionResult.status === "fulfilled" ? subscriptionResult.value : null;
	const wallet = walletResult.status === "fulfilled" ? walletResult.value : null;

	return {
		subscription: current ? { name: current.name, status: current.status } : null,
		...(subscriptionResult.status === "rejected" ? { subscriptionError: toMessage(subscriptionResult.reason) } : {}),
		wallet: wallet
			? {
					// What the merchant can spend: funds held for in-flight sends and registrations are not
					// available, so show balance minus reserved, the same figure the Signal House portal shows.
					balanceMicrodollars: wallet.balance - (wallet.reservedAmount ?? 0),
					currency: wallet.currency,
					hasPaymentMethod: wallet.primaryPaymentMethodId != null,
				}
			: null,
		...(walletResult.status === "rejected" ? { walletError: toMessage(walletResult.reason) } : {}),
	};
}

/**
 * Normalizes a `Promise.allSettled` rejection reason to a readable string.
 * @param {unknown} reason - The rejection reason.
 * @returns {string} A readable error message.
 */
function toMessage(reason: unknown): string {
	return reason instanceof Error ? reason.message : "Could not read billing status";
}
