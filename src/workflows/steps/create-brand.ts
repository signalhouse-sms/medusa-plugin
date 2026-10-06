import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { decryptApiKey } from "../../utils/apiKeyEncryption";
import { buildSignalHouseClient } from "../../utils/signalHouseClient";
import { buildBrandCreatePayload } from "../../utils/brandPayload";
import type { BrandFormInput } from "../../utils/brandPayload";
import { SETTINGS_MODULE } from "../../modules/settings";
import type SettingsModuleService from "../../modules/settings/service";

export type { BrandFormInput };

export type CreateBrandStepInput = {
	accountLink: { api_key_ciphertext: string; subgroup_id: string; brand_id: string | null };
	brandForm: BrandFormInput;
};

type BrandRecord = { _id: string; brandId: string | null; status: string };

// Reuses sms-consent's claim table for an unrelated purpose, same as
// `send-join-confirmation.ts`'s `join-confirmation:` claim already does — established precedent in
// this plugin for a generic "has this action already been claimed" primitive, not sms-consent-private.
const CLAIM_KEY = "submit-brand";
const CLAIM_ID = `claim_${CLAIM_KEY}`;
// Bounds a `pending` claim by age, same technique `join-prompt/route.ts` already uses
// (`IDX_send_claim_key_created`) — long enough to comfortably cover one `/brand` round-trip, short
// enough that a process crash mid-submission (a deploy, a restart) self-heals instead of requiring
// manual SQL to unstick every future submission. Deliberately does NOT bound a `held` claim (see
// below) — a claim only reaches that status because `/brand` may already have billed a real TCR
// registration, and letting THAT expire would let a retry double-bill, defeating the reason the
// claim exists at all. An earlier version of this fix aged out every claim uniformly and silently
// reopened exactly that double-bill window.
const CLAIM_TTL_MINUTES = 5;
// `buildSignalHouseClient`'s axios instance has no default timeout (confirmed: the Signal House SDK's
// `_createClient` passes only `{baseURL, headers}`), so a black-holed connection would leave the
// `/brand` call — and this claim's `pending` status — sitting past CLAIM_TTL_MINUTES with the call
// still genuinely in flight. Once the claim ages out under it, a second submission clears both
// guards and double-bills a live TCR registration. This timeout, well
// under the TTL, guarantees the call resolves (as a `status: null` failure, taking the `held`
// branch below) before that can happen.
const BRAND_CREATE_TIMEOUT_MS = 60_000;

/**
 * Submits a 10DLC brand via `POST /brand` (`sdk.brands.createBrand`) and persists the result
 * immediately after the call returns — not as a separate `save-brand-status` step afterward.
 * `/brand` is not cheap or reversible: it reserves a real `brandCreate` fee and queues a live TCR
 * registration on every call, with no server-side dedupe on `subgroupId`
 * (the Signal House API's brand-creation behavior).
 *
 * Claims a fixed key (`pg_advisory_xact_lock` + `sms_consent_send_claim`, this plugin's one
 * account-per-install architecture means a single global key correctly scopes "this install's one
 * account") **before** re-reading `brand_id` fresh from the database and before calling `/brand` —
 * not the `input.accountLink.brand_id` snapshot the workflow read before this step ran, which two
 * concurrent submissions (two admin tabs, or a second click before the UI's disabled state lands)
 * would both see as `null`. Without the claim, both pass the guard, both call `/brand`, and Signal
 * House registers and bills two live TCR brands for the same business (audit finding). The claim
 * check and the fresh re-read happen inside the SAME locked transaction as the insert, closing the
 * TOCTOU window the original snapshot-based check left open; the external `/brand` call and the
 * persist happen after that transaction commits, so the advisory lock isn't held across a slow
 * network round-trip.
 *
 * The claim has three lifecycles, tracked via `sms_consent_send_claim.status`, not treated
 * uniformly (two earlier versions of this fix each got this wrong in opposite directions — see the
 * two bugs below):
 * - **Released** (row deleted) as soon as it's provably safe: `saveBrandStatus` persists (the
 *   durable guard from then on is `account_link.brand_id` itself, which the locked re-read above
 *   already checks), or `/brand` is definitively rejected (a real HTTP status came back — nothing
 *   was billed), or nothing was even sent yet (a `decryptApiKey`/client-build failure).
 * - **`held`** (status updated, row kept — see `CLAIM_TTL_MINUTES`) when it's NOT provably safe:
 *   `/brand` returns with no response at all (`response.status == null` — a transport failure,
 *   where `queueCreateBrand` may have already reserved the fee and created the brand row before the
 *   response was lost), or `/brand` succeeded but `saveBrandStatus` then failed to persist. Both
 *   mean a real TCR registration may already exist with nothing local pointing at it; releasing
 *   either would let a retry register and bill a SECOND live brand. That state needs a human to
 *   reconcile against the logged brand id, not an automatic retry — first found as a released-
 *   unconditionally bug, fixed to distinguish these, then a follow-up bug let a uniform TTL expire
 *   even THIS status and reopen the same double-bill window; `held` is now exempt from the TTL.
 * - **`pending`, TTL-bounded**: the normal in-flight state while a submission is genuinely running.
 *   Ages out after `CLAIM_TTL_MINUTES` so a process crash between the claim commit and any of the
 *   resolutions above (a deploy, a restart) self-heals — this is the ONLY state the TTL applies to.
 *   Without this, a merchant who re-links to a *different* Signal House account
 *   (`settings/service.ts`'s `saveAccountLink` intentionally clears `brand_id` for a genuine account
 *   change) could never submit a brand again after an orphaned claim, with no in-product recovery.
 * @param {CreateBrandStepInput} input - The account to submit under and the brand form fields.
 * @returns {Promise<StepResponse>} The updated `account_link` row.
 * @throws {MedusaError} - When the account already has (or just claimed) a brand, or `/brand`
 *   rejects the submission.
 */
export const createBrandStep = createStep("create-brand", async (input: CreateBrandStepInput, { container }) => {
	const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
	const settingsService: SettingsModuleService = container.resolve(SETTINGS_MODULE);
	const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

	let alreadyHasBrand = false;
	await pgConnection.transaction(async (trx: any) => {
		await trx.raw(`select pg_advisory_xact_lock(hashtext(?))`, [CLAIM_KEY]);
		const cooldownStart = new Date(Date.now() - CLAIM_TTL_MINUTES * 60 * 1000);
		// A `held` claim blocks unconditionally, regardless of age (see CLAIM_TTL_MINUTES's own
		// comment); only a `pending` one is subject to the TTL.
		const { rows: claimRows } = await trx.raw(
			`select 1 from sms_consent_send_claim where claim_key = ? and (status <> 'pending' or created_at > ?) limit 1`,
			[CLAIM_KEY, cooldownStart.toISOString()],
		);
		const { rows: brandRows } = await trx.raw(`select brand_id from account_link limit 1`);
		if (claimRows.length || brandRows[0]?.brand_id) {
			alreadyHasBrand = true;
			return;
		}
		// A stale `pending` claim (older than the TTL, from a crashed prior attempt) may still exist
		// as a row — upsert rather than a plain insert so it doesn't collide on the primary key, and
		// reset status back to `pending` in case it's somehow a leftover `held` row past its own
		// resolution (a human cleared the underlying account_link.brand_id state without deleting
		// this row).
		await trx.raw(
			`insert into sms_consent_send_claim (id, claim_key, status, created_at) values (?, ?, 'pending', now())
			 on conflict (id) do update set status = 'pending', created_at = now()`,
			[CLAIM_ID, CLAIM_KEY],
		);
	});

	if (alreadyHasBrand) {
		throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This account already has a brand registered.");
	}

	// Nothing has been sent yet at this point — a throw from either of these (a malformed ciphertext,
	// say) means no request went out, so it's always safe to release on that path specifically.
	let client;
	try {
		const apiKey = decryptApiKey(input.accountLink.api_key_ciphertext);
		client = buildSignalHouseClient(apiKey);
	} catch (err) {
		await pgConnection.raw(`delete from sms_consent_send_claim where id = ?`, [CLAIM_ID]);
		throw err;
	}

	const response = await client.brands.createBrand({
		brandData: buildBrandCreatePayload(input.accountLink.subgroup_id, input.brandForm),
		options: { timeout: BRAND_CREATE_TIMEOUT_MS },
	});

	if (!response?.success) {
		const message = JSON.stringify(response?.error ?? "unknown error");
		// Only a genuine 4xx is a DEFINITIVE rejection: `queueCreateBrand` validates, authorizes, and
		// checks the subgroup BEFORE it ever calls `BillingService.reserveFunds`/creates the brand row
		// on the Signal House API — every one of those failure modes responds 4xx,
		// before anything is billed. A `null` status (transport failure/timeout — the SDK's axios
		// interceptor never rejects, verified against the Signal House SDK) or a 5xx does NOT mean
		// nothing was billed: `queueCreateBrand` reserves the fee and creates the brand row, THEN
		// queues SQS and responds, so an SQS failure or a gateway 502/504 after that point still
		// returns a real non-2xx status with the fee already reserved and a live brand already queued
		// for TCR registration. An earlier version of this fix treated "any real HTTP status" as safe
		// to release, which missed exactly this 5xx case.
		if (response?.status == null || response.status >= 500) {
			// Marked `held`, not just left alone: a `pending` claim ages out via CLAIM_TTL_MINUTES, and
			// this specific claim must NOT — it's the one case that TTL's own comment says must survive.
			await pgConnection.raw(`update sms_consent_send_claim set status = 'held' where id = ?`, [CLAIM_ID]);
			logger.error(
				`signalhouse-sms: /brand call failed with status ${response?.status ?? "unknown"} — holding the claim in case it was billed at Signal House: ${message}`,
			);
		} else {
			await pgConnection.raw(`delete from sms_consent_send_claim where id = ?`, [CLAIM_ID]);
		}
		throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Could not submit that brand: ${message}`);
	}

	const brand = response.data as BrandRecord;

	let accountLink: Awaited<ReturnType<typeof settingsService.saveBrandStatus>>;
	try {
		accountLink = await settingsService.saveBrandStatus({
			brandId: brand._id,
			brandCarrierId: brand.brandId ?? null,
			brandStatus: brand.status,
		});
	} catch (err) {
		// `/brand` already succeeded and billed a real TCR registration — releasing the claim here
		// would let a retry register (and bill) a second one for a submission that already went
		// through. Marked `held` (not just left as `pending`, which would still age out via
		// CLAIM_TTL_MINUTES) so it survives regardless of how long reconciliation takes; logged
		// loudly since this account's brand_id is the only record of the id `/brand` actually
		// assigned.
		await pgConnection.raw(`update sms_consent_send_claim set status = 'held' where id = ?`, [CLAIM_ID]);
		logger.error(
			`signalhouse-sms: brand ${brand._id} was created at Signal House but failed to persist locally — manual reconciliation needed: ${err instanceof Error ? err.message : String(err)}`,
		);
		throw err;
	}

	// Deliberately outside the try above: a failure HERE means the persist already succeeded (the
	// durable `account_link.brand_id` guard is in place), so it must not be logged or treated as the
	// "failed to persist" case — only the claim-cleanup itself didn't complete. Harmless either way
	// (the held claim and the set `brand_id` are redundant guards from here on), just worth its own
	// log line instead of a misleading "failed to persist" one.
	try {
		await pgConnection.raw(`delete from sms_consent_send_claim where id = ?`, [CLAIM_ID]);
	} catch (err) {
		logger.error(`signalhouse-sms: brand ${brand._id} persisted, but failed to release the submit-brand claim: ${err instanceof Error ? err.message : String(err)}`);
	}

	return new StepResponse(accountLink);
});
