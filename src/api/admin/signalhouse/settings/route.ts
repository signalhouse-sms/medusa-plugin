import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import { SETTINGS_MODULE } from "../../../../modules/settings";
import type SettingsModuleService from "../../../../modules/settings/service";
import { linkAccountWorkflow } from "../../../../workflows/link-account";
import { setSmsCostPerSegmentWorkflow } from "../../../../workflows/set-sms-cost-per-segment";
import { toAccountLinkResponse, type AccountLinkRow } from "../../../../utils/accountLinkResponse";
import { decryptApiKey } from "../../../../utils/apiKeyEncryption";
import { buildSignalHouseClient } from "../../../../utils/signalHouseClient";
import { fetchBillingStatus, type BillingStatus } from "../../../../utils/billingStatus";

const DEFAULT_STORE_NAME = "Medusa Store";

/** Signal House's production portal hostname — where a merchant manages their plan and payment method. */
const DEFAULT_PORTAL_URL = "https://app2.signalhouse.io";

/**
 * Adds the broadcast-send job's enabled/disabled state to a settings response. Read fresh on every
 * request, not cached — this is a plain env var (`jobs/broadcast-send.ts`'s own disabled-by-default
 * gate), so it can change between one request and the next only via a real deploy/restart, and
 * caching it would just add a staleness risk for no benefit.
 *
 * Surfaced here (not just left to the job's own silent no-op) because the admin UI's Broadcasts
 * page has no other way to know a "Send now" broadcast will actually be sent: on the default
 * install this flag is `false`, `createBroadcastWithRecipients` still marks an immediate broadcast
 * `sending`, and without this field the merchant sees a success toast and a broadcast stuck at
 * `sending` forever with no indication why.
 * @param {ReturnType<typeof toAccountLinkResponse>} response - The account-link response to extend.
 * @returns {object} The response with `broadcastSendingEnabled` added.
 */
export function withBroadcastSendingEnabled<T extends object>(response: T) {
	return { ...response, broadcastSendingEnabled: process.env.SIGNALHOUSE_MARKETING_BROADCAST_ENABLED === "true" };
}

/**
 * Adds live subscription/wallet status to a settings response. Called from all three
 * `settings` handlers below (POST/PUT unconditionally — only the settings page's own connect/save
 * actions reach those — and GET only when `includeBilling` is passed, see the GET handler's own
 * comment) so the section never regresses to a stale/absent state after a connect or a pricing save.
 *
 * A no-op (returns `response` unchanged, no `billingStatus` key at all) when nothing is linked yet
 * or `includeBilling` is false — there's no account to check, or the caller doesn't want the extra
 * round-trips. Never throws: this wraps its own decrypt + client-build + fetch in a try/catch, so a
 * corrupted ciphertext or a rotated/missing `SIGNALHOUSE_SETTINGS_ENCRYPTION_KEY` degrades into an
 * error field instead of 500ing an otherwise-healthy GET, or making POST/PUT report failure for a
 * mutation that already succeeded (both call this from inside their own success path — see below).
 * @async
 * @param {ReturnType<typeof toAccountLinkResponse>} response - The account-link response to extend.
 * @param {(AccountLinkRow & { api_key_ciphertext: string }) | null} accountLink - The raw linked
 *   account row (or null), source of the encrypted API key and group id this needs to call out with.
 * @param {boolean} [includeBilling=true] - Whether to actually fetch billing status this call.
 * @returns {Promise<object>} The response with `billingStatus`/`billingPortalUrl` added when an
 *   account is linked and `includeBilling` is true.
 */
export async function withBillingStatus<T extends object>(
	response: T,
	accountLink: (AccountLinkRow & { api_key_ciphertext: string }) | null,
	includeBilling = true,
): Promise<T | (T & { billingStatus: BillingStatus; billingPortalUrl: string })> {
	if (!accountLink || !includeBilling) return response;

	const billingPortalUrl = process.env.SIGNALHOUSE_PORTAL_URL || DEFAULT_PORTAL_URL;
	try {
		const client = buildSignalHouseClient(decryptApiKey(accountLink.api_key_ciphertext));
		const billingStatus = await fetchBillingStatus(client, accountLink.group_id);
		return { ...response, billingStatus, billingPortalUrl };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Could not read billing status";
		return { ...response, billingStatus: { subscription: null, subscriptionError: message, wallet: null, walletError: message }, billingPortalUrl };
	}
}

/**
 * Returns this install's Signal House connection status. Never returns the API key, encrypted or
 * otherwise — only `apiKeyLast4` and the resolved group/subgroup/brand state.
 *
 * Billing status (2 extra outbound Signal House calls) is only fetched when the caller passes
 * `?includeBilling=1` — this route is also polled by the Broadcasts page purely for
 * `broadcastSendingEnabled` (`broadcasts/page.tsx`), which has no use for billing status and
 * shouldn't pay its latency on every load. Only the Signal House settings
 * page itself passes the flag.
 * @async
 * @param {MedusaRequest} req - The request.
 * @param {MedusaResponse} res - The response.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
	const settingsService: SettingsModuleService = req.scope.resolve(SETTINGS_MODULE);
	const accountLink = await settingsService.getAccountLink();

	const includeBilling = req.query.includeBilling === "1";
	const response = await withBillingStatus(withBroadcastSendingEnabled(toAccountLinkResponse(accountLink)), accountLink, includeBilling);
	res.status(200).json(response);
}

/**
 * Connects this install to a Signal House account: verifies the pasted API key, ensures a subgroup
 * to register a brand under, and persists the link. Backs the admin settings screen's "Connect"
 * (and "Change key") action.
 * @async
 * @param {MedusaRequest} req - The request. Body: `{ apiKey: string }`.
 * @param {MedusaResponse} res - The response.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
	const body = req.body as { apiKey?: string };
	const apiKey = body.apiKey?.trim();
	if (!apiKey) {
		res.status(400).json({ message: "apiKey is required" });
		return;
	}

	// The subgroup a brand-new account needs is named after the Medusa store itself, so the admin
	// UI never has to ask the merchant to type a name that's already sitting in their own Store
	// settings.
	const storeModuleService = req.scope.resolve(Modules.STORE);
	const [store] = await storeModuleService.listStores();
	const storeName = store?.name || DEFAULT_STORE_NAME;

	try {
		const { result } = await linkAccountWorkflow(req.scope).run({ input: { apiKey, storeName } });
		const response = await withBillingStatus(withBroadcastSendingEnabled(toAccountLinkResponse(result.accountLink)), result.accountLink);
		res.status(200).json(response);
	} catch (err) {
		res.status(400).json({ message: err instanceof Error ? err.message : "Could not connect that account." });
	}
}

/**
 * Sets the merchant's per-segment SMS cost assumption, used only as the ROI cost basis on
 * `GET /admin/signalhouse/analytics/attribution` — see `SettingsModuleService.setSmsCostPerSegmentCents`'s
 * own JSDoc for why this is a stand-in rather than real billing data.
 * @async
 * @param {MedusaRequest} req - The request. Body: `{ smsCostPerSegmentCents: number | null }`.
 * @param {MedusaResponse} res - The response.
 */
export async function PUT(req: MedusaRequest, res: MedusaResponse): Promise<void> {
	const body = req.body as { smsCostPerSegmentCents?: unknown };

	// Must be a whole number of cents — the `sms_cost_per_segment_cents` column is `int`
	// (`Migration20260906130000.ts`), so a fraction (e.g. sub-cent wholesale A2P pricing like
	// $0.0075/segment) would either get silently rounded by Postgres or rejected there, surfacing
	// as an opaque "Could not save pricing." with no hint that fractions are the problem
	// — rejected here instead, with a message that says why.
	if (body.smsCostPerSegmentCents !== null && (typeof body.smsCostPerSegmentCents !== "number" || !Number.isInteger(body.smsCostPerSegmentCents) || body.smsCostPerSegmentCents < 0)) {
		res.status(400).json({ message: "smsCostPerSegmentCents must be a non-negative whole number of cents, or null" });
		return;
	}

	try {
		const { result } = await setSmsCostPerSegmentWorkflow(req.scope).run({
			input: { centsPerSegment: (body.smsCostPerSegmentCents as number | null | undefined) ?? null },
		});
		const response = await withBillingStatus(withBroadcastSendingEnabled(toAccountLinkResponse(result.accountLink)), result.accountLink);
		res.status(200).json(response);
	} catch (err) {
		res.status(400).json({ message: err instanceof Error ? err.message : "Could not save pricing." });
	}
}
