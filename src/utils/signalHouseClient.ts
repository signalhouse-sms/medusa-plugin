import { SignalHouseSDK } from "@signalhousellc/sdk";
import { MedusaError } from "@medusajs/framework/utils";

/** Signal House's production API base URL, matching `providers/signalhouse-sms/service.ts`'s own default. */
export const DEFAULT_SIGNALHOUSE_BASE_URL = "https://v2.signalhouse.io";

/**
 * Every SDK domain method resolves this envelope regardless of HTTP status — `SignalHouseSDK`'s
 * axios response interceptor never rejects, it maps a 2xx to `{ success: true, data, status }` and
 * a non-2xx to `{ success: false, error, status }` (`@signalhousellc/sdk`'s `_createClient`). The
 * SDK ships no type declarations, so nothing catches an unwrapped `response.<field>` read at
 * compile time — `providers/signalhouse-sms/service.ts` already unwraps this correctly for
 * `messages.sendSMS`; this is the same unwrap, shared so every settings workflow step does it too.
 */
type SignalHouseEnvelope<T> = { success?: boolean; data?: T; error?: unknown; status?: number };

/**
 * Unwraps a `SignalHouseSDK` call's response envelope, throwing when the call failed.
 * @param {SignalHouseEnvelope<T>} response - The raw envelope an SDK domain method resolved to.
 * @param {string} errorPrefix - Prefixed to the thrown message, so the caller can be identified.
 * @returns {T} The envelope's `data`.
 * @throws {MedusaError} - When `response.success` is not `true`.
 */
export function unwrapSignalHouseResponse<T>(response: SignalHouseEnvelope<T> | undefined, errorPrefix: string): T {
	if (!response?.success) {
		throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `${errorPrefix}: ${JSON.stringify(response?.error ?? "unknown error")}`);
	}
	return response.data as T;
}

/**
 * Builds a `SignalHouseSDK` client for a plaintext API key. Shared by every settings workflow step
 * that needs to call the Signal House API (`verify-api-key`, `ensure-subgroup`, `create-brand`,
 * `fetch-brand-status`) so the base-URL default lives in exactly one place.
 * @param {string} apiKey - The plaintext Signal House API key.
 * @returns {SignalHouseSDK} A client scoped to that key.
 */
export function buildSignalHouseClient(apiKey: string): SignalHouseSDK {
	return new SignalHouseSDK({
		apiKey,
		baseUrl: process.env.SIGNALHOUSE_API_BASE_URL || DEFAULT_SIGNALHOUSE_BASE_URL,
	});
}
