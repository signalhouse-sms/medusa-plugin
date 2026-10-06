import { test } from "node:test";
import assert from "node:assert/strict";
import type { SignalHouseSDK } from "@signalhousellc/sdk";
import { fetchBillingStatus } from "./billingStatus";

/**
 * Builds a stub client shaped like the two `SignalHouseSDK` methods `fetchBillingStatus` calls.
 * Only `subscriptions.getSubscriptions` and `billing.getWallet` are ever touched, so nothing else
 * needs stubbing — matches this plugin's existing test style of a plain object stub, no mocking
 * library.
 * @param {object} responses - The raw envelopes each call should resolve to.
 * @param {unknown} [responses.subscriptions] - `subscriptions.getSubscriptions`'s resolved value.
 * @param {unknown} [responses.wallet] - `billing.getWallet`'s resolved value.
 * @returns {SignalHouseSDK} A stub client.
 */
function stubClient({ subscriptions, wallet }: { subscriptions?: unknown; wallet?: unknown }): SignalHouseSDK {
	return {
		subscriptions: { getSubscriptions: async () => subscriptions },
		billing: { getWallet: async () => wallet },
	} as unknown as SignalHouseSDK;
}

test("fetchBillingStatus returns the active subscription and funded wallet", async () => {
	const client = stubClient({
		subscriptions: { success: true, data: [{ name: "Growth", status: "ACTIVE" }] },
		wallet: { success: true, data: { balance: 25_000_000, currency: "USD", primaryPaymentMethodId: "pm_123" } },
	});

	const status = await fetchBillingStatus(client, "G1");

	assert.deepEqual(status, {
		subscription: { name: "Growth", status: "ACTIVE" },
		wallet: { balanceMicrodollars: 25_000_000, currency: "USD", hasPaymentMethod: true },
	});
});

test("fetchBillingStatus reports the available balance, net of reserved funds", async () => {
	const client = stubClient({
		subscriptions: { success: true, data: [{ name: "Growth", status: "ACTIVE" }] },
		wallet: { success: true, data: { balance: 25_000_000, reservedAmount: 4_000_000, currency: "USD", primaryPaymentMethodId: "pm_123" } },
	});

	const status = await fetchBillingStatus(client, "G1");

	assert.equal(status.wallet?.balanceMicrodollars, 21_000_000);
});

test("fetchBillingStatus prefers an ACTIVE row over a PENDING_DOWNGRADE one", async () => {
	const client = stubClient({
		subscriptions: {
			success: true,
			data: [
				{ name: "Legacy", status: "PENDING_DOWNGRADE" },
				{ name: "Growth", status: "ACTIVE" },
			],
		},
		wallet: { success: true, data: { balance: 0, currency: "USD", primaryPaymentMethodId: null } },
	});

	const status = await fetchBillingStatus(client, "G1");

	assert.equal(status.subscription?.name, "Growth");
});

test("fetchBillingStatus reports no active plan when the subscriptions array is empty", async () => {
	const client = stubClient({
		subscriptions: { success: true, data: [] },
		wallet: { success: true, data: { balance: 0, currency: "USD", primaryPaymentMethodId: null } },
	});

	const status = await fetchBillingStatus(client, "G1");

	assert.equal(status.subscription, null);
	assert.equal(status.wallet?.hasPaymentMethod, false);
});

test("fetchBillingStatus surfaces a subscription-read failure without hiding a successful wallet read", async () => {
	const client = stubClient({
		subscriptions: { success: false, error: "subscription service down" },
		wallet: { success: true, data: { balance: 10_000_000, currency: "USD", primaryPaymentMethodId: "pm_123" } },
	});

	const status = await fetchBillingStatus(client, "G1");

	assert.equal(status.subscription, null);
	assert.match(status.subscriptionError ?? "", /subscription service down/);
	assert.deepEqual(status.wallet, { balanceMicrodollars: 10_000_000, currency: "USD", hasPaymentMethod: true });
	assert.equal(status.walletError, undefined);
});

test("fetchBillingStatus surfaces a wallet-read failure without hiding a successful subscription read", async () => {
	const client = stubClient({
		subscriptions: { success: true, data: [{ name: "Growth", status: "ACTIVE" }] },
		wallet: { success: false, error: "wallet service down" },
	});

	const status = await fetchBillingStatus(client, "G1");

	assert.deepEqual(status.subscription, { name: "Growth", status: "ACTIVE" });
	assert.equal(status.subscriptionError, undefined);
	assert.equal(status.wallet, null);
	assert.match(status.walletError ?? "", /wallet service down/);
});

test("fetchBillingStatus tolerates the client itself throwing (network failure)", async () => {
	const client = {
		subscriptions: { getSubscriptions: async () => { throw new Error("ECONNREFUSED"); } },
		billing: { getWallet: async () => { throw new Error("ECONNREFUSED"); } },
	} as unknown as SignalHouseSDK;

	const status = await fetchBillingStatus(client, "G1");

	assert.equal(status.subscription, null);
	assert.equal(status.wallet, null);
	assert.match(status.subscriptionError ?? "", /ECONNREFUSED/);
	assert.match(status.walletError ?? "", /ECONNREFUSED/);
});

test("fetchBillingStatus passes an explicit timeout on both calls so a hung upstream can't hang the caller", async () => {
	let subscriptionTimeout: unknown;
	let walletTimeout: unknown;
	const client = {
		subscriptions: {
			getSubscriptions: async ({ options }: { options?: { timeout?: number } }) => {
				subscriptionTimeout = options?.timeout;
				return { success: true, data: [] };
			},
		},
		billing: {
			getWallet: async ({ options }: { options?: { timeout?: number } }) => {
				walletTimeout = options?.timeout;
				return { success: true, data: { balance: 0, currency: "USD", primaryPaymentMethodId: null } };
			},
		},
	} as unknown as SignalHouseSDK;

	await fetchBillingStatus(client, "G1");

	assert.equal(typeof subscriptionTimeout, "number");
	assert.equal(typeof walletTimeout, "number");
});
