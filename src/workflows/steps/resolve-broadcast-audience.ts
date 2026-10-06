import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils";
import { normalizeNanpPhone } from "../../utils/phoneNumber";

export type ResolveBroadcastAudienceStepInput = {
	/** Scope the audience to one customer group's members. Null means "every marketing-consented
	 * customer, guests included." */
	customerGroupId: string | null;
};

export type ResolvedBroadcastRecipient = {
	phoneNumber: string;
	customerId: string | null;
};

type ConsentRow = { phone_number: string; customer_id: string | null };

// A hard ceiling on one broadcast's audience: the resolved list is bulk-inserted as one
// `broadcast_recipient` row per recipient and passed through a workflow step's `StepResponse`,
// which the workflow engine serializes and persists as step output. Above this, that insert and
// serialization are the actual risk, not the query — see the migration in this same PR
// (`Migration20260905231500`) for the covering index that keeps the query itself cheap regardless
// of table size.
const MAX_AUDIENCE_SIZE = 100_000;

/**
 * Resolves who a broadcast should send to: every phone number whose LATEST `marketing`-purpose
 * `consent_record` is not revoked, optionally intersected with a customer group's members.
 *
 * `consent_record` is append-only (a new row per grant/revoke cycle — see the model's own JSDoc),
 * so "currently consented" is not a simple `revoked_at IS NULL` filter over the whole table; that
 * would also match every OLDER row from a customer who has since revoked and re-granted, or worse,
 * miss a revocation entirely if the revoke created a new row rather than updating the grant (which
 * is exactly what `revokeConsent`/`revokeByPhone` do — they update the active row's `revoked_at`
 * in place, but a customer can still have granted, revoked, and re-granted across three separate
 * rows). `DISTINCT ON (phone_number) ... ORDER BY phone_number, granted_at DESC` picks each phone
 * number's single most recent row before this ever checks `revoked_at`, which is the same
 * "latest row wins" rule `checkEligibility`/`checkEligibilityByPhone` already apply one phone
 * number at a time (`order: { granted_at: "DESC" }, take: 1`) — this just does it for every phone
 * number in one query instead of the module's own CRUD methods, which have no server-side
 * "distinct latest per group" primitive to express this with.
 *
 * Group scoping intersects by NORMALIZED PHONE NUMBER, not `consent_record.customer_id` — every
 * marketing consent row today comes from a JOIN-keyword reply (the only caller of `grantConsent`,
 * `workflows/steps/grant-join-consent.ts`), which is deliberately customer-less (a carrier-confirmed
 * inbound SMS can't be tied to a browsing session — see that consent module's own JSDoc). Filtering
 * on `customerId` would silently resolve every group-scoped broadcast to zero recipients today,
 * marked `sent` with nobody actually messaged (ai-review, PR #1318, round 1) — phone number is this
 * module's own stated identity anchor, and matching on it works whether or not a future consent
 * path ever populates `customer_id`.
 *
 * The group's member phones are pushed INTO the consent query (bound as one JSON array) rather than
 * fetched unbounded and intersected in JS afterward — the two need to compose correctly with
 * `MAX_AUDIENCE_SIZE` below. A LIMIT on the raw consent scan alone, applied before intersecting with
 * a group, would silently truncate to whichever phone numbers sort first and then intersect that
 * truncated (effectively arbitrary) subset with the group — a small group could resolve to zero
 * recipients purely because its members' numbers didn't happen to sort into the truncated page, not
 * because they aren't actually consented. Scoping the SQL itself to the group's numbers keeps the
 * result both correct and bounded by the group's own size.
 *
 * The revoked-row filter is applied INSIDE the SQL (a `WHERE latest.revoked_at IS NULL` around the
 * `DISTINCT ON` subquery), not in JS after the fact — for the same reason the group's members are
 * pushed into SQL rather than intersected afterward. The unscoped branch's LIMIT has to count only
 * already-eligible rows; filtering revoked rows in JS after a SQL-side LIMIT would let the LIMIT
 * quietly truncate to fewer than `MAX_AUDIENCE_SIZE` real recipients (some of the capped page turns
 * out revoked and gets dropped) without ever tripping the overflow check below — a large store with
 * many revocations could silently under-deliver a broadcast with no error raised at all (ai-review,
 * PR #1318, round 3).
 * @param {ResolveBroadcastAudienceStepInput} input - The optional customer-group scope.
 * @returns {Promise<StepResponse>} The resolved recipient list.
 * @throws {MedusaError} - When `customerGroupId` doesn't resolve to a real customer group
 *   (`retrieveCustomerGroup` throws `NOT_FOUND`), or the resolved audience exceeds
 *   `MAX_AUDIENCE_SIZE`.
 */
export const resolveBroadcastAudienceStep = createStep(
	"resolve-broadcast-audience",
	async (input: ResolveBroadcastAudienceStepInput, { container }) => {
		const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);

		let memberPhones: string[] | null = null;
		if (input.customerGroupId) {
			const customerModuleService = container.resolve(Modules.CUSTOMER);
			// Throws MedusaError NOT_FOUND for a bogus/deleted group id — a clear 400 for the admin
			// route to surface, rather than silently resolving an empty audience.
			await customerModuleService.retrieveCustomerGroup(input.customerGroupId);

			const members = await customerModuleService.listCustomers({ groups: [input.customerGroupId] });
			memberPhones = [
				...new Set(members.map((customer) => (customer.phone ? normalizeNanpPhone(customer.phone) : null)).filter(Boolean) as string[]),
			];

			if (memberPhones.length === 0) {
				return new StepResponse({ recipients: [] });
			}
			if (memberPhones.length > MAX_AUDIENCE_SIZE) {
				throw new MedusaError(
					MedusaError.Types.INVALID_DATA,
					`This customer group has ${memberPhones.length} members, over the ${MAX_AUDIENCE_SIZE}-recipient limit for a single broadcast.`,
				);
			}
		}

		// The member list is bound as ONE JSON string and unpacked in SQL. A JS array bound to `in (?)`
		// reaches Postgres as a single array literal ('{"555...","918..."}'), so it matched nothing and
		// every group broadcast resolved to zero recipients. One string binding also
		// stays clear of Postgres's 65,535 bind-parameter limit at MAX_AUDIENCE_SIZE.
		const { rows } = memberPhones
			? await pgConnection.raw(
					`select phone_number, customer_id from (
					   select distinct on (phone_number) phone_number, customer_id, revoked_at
					   from consent_record
					   where purpose = 'marketing' and deleted_at is null
					     and phone_number in (select jsonb_array_elements_text(?::jsonb))
					   order by phone_number, granted_at desc
					 ) latest
					 where latest.revoked_at is null`,
					[JSON.stringify(memberPhones)],
				)
			: await pgConnection.raw(
					// The revoked filter is applied INSIDE the subquery, before the outer LIMIT — doing
					// it after (filtering in JS on an already phone_number-limited page) would let the
					// LIMIT quietly truncate to fewer than MAX_AUDIENCE_SIZE eligible recipients without
					// ever tripping the overflow check below, since JS-side filtering can only shrink an
					// already-capped set (ai-review, PR #1318, round 3).
					`select phone_number, customer_id from (
					   select distinct on (phone_number) phone_number, customer_id, revoked_at
					   from consent_record
					   where purpose = 'marketing' and deleted_at is null
					   order by phone_number, granted_at desc
					 ) latest
					 where latest.revoked_at is null
					 limit ?`,
					[MAX_AUDIENCE_SIZE + 1],
				);

		const recipients: ResolvedBroadcastRecipient[] = (rows as ConsentRow[]).map((row) => ({
			phoneNumber: row.phone_number,
			customerId: row.customer_id,
		}));

		if (recipients.length > MAX_AUDIENCE_SIZE) {
			throw new MedusaError(
				MedusaError.Types.INVALID_DATA,
				`This broadcast's audience (${recipients.length}+) exceeds the ${MAX_AUDIENCE_SIZE}-recipient limit for a single broadcast.`,
			);
		}

		return new StepResponse({ recipients });
	},
);
