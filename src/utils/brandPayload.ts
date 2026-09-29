/**
 * The 10DLC brand fields the admin UI collects. `entityType` stays restricted to `PRIVATE_PROFIT`/
 * `NON_PROFIT` — `PUBLIC_PROFIT` and `GOVERNMENT` hard-fail `/brand` registration without fields this
 * form doesn't collect (a stock symbol/exchange, and a US-only address respectively), the same
 * constraint the Signal House Shopify app's onboarding form already documents and enforces.
 */
export type BrandFormInput = {
	legalCompanyName: string;
	dba?: string;
	entityType: "PRIVATE_PROFIT" | "NON_PROFIT";
	country: string;
	ein: string;
	street: string;
	city: string;
	state: string;
	postalCode: string;
	firstName: string;
	lastName: string;
	email: string;
	phone: string;
	vertical: string;
	website?: string;
};

/**
 * A subset of the real `CreateBrandData` shape (the Signal House SDK's brand API) — only the
 * fields this plugin ever sends.
 */
export type BrandCreatePayload = {
	subgroupId: string;
	entityType: "PRIVATE_PROFIT" | "NON_PROFIT";
	displayName: string;
	companyName: string;
	ein: string;
	firstName: string;
	lastName: string;
	phone: string;
	street: string;
	city: string;
	state: string;
	postalCode: string;
	country: string;
	email: string;
	vertical: string;
	website?: string;
	businessContactEmail?: string;
	stockSymbol: string;
	stockExchange: string;
};

/**
 * Normalizes a possibly scheme-less website into a real, format-valid URL, or returns "" when it
 * isn't one. Matches the Signal House Shopify app's website normalization — `/brand`
 * validates `website` with `z.url().optional()`, which permits `undefined` but not `""`
 * (the Signal House API's brand schema), so the caller must omit the key entirely for a
 * blank/invalid value rather than sending an empty string.
 * @param {string} [value] - The raw website input.
 * @returns {string} A normalized `https://...` URL, or "" if `value` isn't a usable one.
 */
export function normalizeWebsite(value?: string): string {
	const raw = (value || "").trim();
	if (!raw) return "";

	const candidate = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw) ? raw : `https://${raw}`;
	try {
		const url = new URL(candidate);
		if (!["http:", "https:"].includes(url.protocol)) return "";
		if (!url.hostname || !url.hostname.includes(".")) return "";
		return url.toString().replace(/\/$/, "");
	} catch {
		return "";
	}
}

/**
 * Strips a formatted EIN/phone display value down to bare digits before it's sent to `/brand` and
 * on to TCR. The admin UI stores display-formatted values (`12-3456789`, `(415) 555-0182` — see
 * `admin/lib/brandFormOptions.ts`'s `formatEinInput`/`formatUsPhoneInput`); `/brand` only bounds
 * their length (the Signal House API's brand schema), so a formatted value passes validation but reaches TCR
 * unnormalized (both fields are forwarded to TCR verbatim).
 * @param {string} value - The display-formatted value.
 * @returns {string} Digits only.
 */
export function digitsOnly(value: string): string {
	return (value || "").replace(/\D/g, "");
}

/**
 * Builds the `/brand` request payload from the admin UI's brand form. `entityType` is restricted to
 * `PRIVATE_PROFIT`/`NON_PROFIT` (see `create-brand.ts`'s header). `businessContactEmail` is only
 * required for `NON_PROFIT` (`CreateBrandData`'s own JSDoc); `stockSymbol`/`stockExchange` are set
 * unconditionally for every entity type here, matching the Signal House Shopify app's onboarding
 * rather than guessing they can be omitted. `website`
 * is omitted entirely rather than sent as `""` when blank/invalid — see `normalizeWebsite`.
 * @param {string} subgroupId - The subgroup to register the brand under.
 * @param {BrandFormInput} form - The submitted brand form fields.
 * @returns {BrandCreatePayload} The payload for `sdk.brands.createBrand`.
 */
export function buildBrandCreatePayload(subgroupId: string, form: BrandFormInput): BrandCreatePayload {
	const website = normalizeWebsite(form.website);

	return {
		subgroupId,
		entityType: form.entityType,
		displayName: form.dba || form.legalCompanyName,
		companyName: form.legalCompanyName,
		ein: digitsOnly(form.ein),
		firstName: form.firstName,
		lastName: form.lastName,
		phone: digitsOnly(form.phone),
		street: form.street,
		city: form.city,
		state: form.state,
		postalCode: form.postalCode,
		country: form.country,
		email: form.email,
		vertical: form.vertical,
		...(website ? { website } : {}),
		...(form.entityType === "NON_PROFIT" ? { businessContactEmail: form.email } : {}),
		stockSymbol: "",
		stockExchange: "NONE",
	};
}

/**
 * Picks the subgroup to register a brand under from an account's existing subgroups — the first
 * *active* one, if any (a merchant may already use Signal House for other things and this plugin
 * should not create a second subgroup on every re-link). Returns null when a new one needs to be
 * created. Filtering on `status` matters: `GET /subgroup` returns every subgroup regardless of
 * status, deterministically sorted (`subgroup.service.js`'s `readSubgroupByGroupId` has no status
 * predicate), and `/brand` hard-rejects an inactive one (`SubgroupInactiveError`,
 * `brand.service.js`'s `queueCreateBrand`) — an unfiltered pick can permanently dead-end brand
 * registration on a soft-deleted (`status: "inactive"`) subgroup, including one this plugin's own
 * `ensure-subgroup` compensation just deactivated.
 * @param {{ subgroupId: string; status?: string }[]} subgroups - The account's existing subgroups.
 * @returns {string | null} The subgroup id to reuse, or null if none are active.
 */
export function pickExistingSubgroupId(subgroups: { subgroupId: string; status?: string }[]): string | null {
	const active = subgroups.find((subgroup) => subgroup.status === "active");
	return active ? active.subgroupId : null;
}
