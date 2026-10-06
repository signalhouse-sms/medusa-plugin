import { useEffect, useState } from "react";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ChatBubbleLeftRight } from "@medusajs/icons";
import { Badge, Button, Container, Heading, InlineTip, Input, Label, Select, StatusBadge, Text, toast } from "@medusajs/ui";
import {
	COUNTRY_OPTIONS, DEFAULT_COUNTRY, DEFAULT_ENTITY_TYPE, DEFAULT_VERTICAL,
	ENTITY_TYPE_OPTIONS, formatEinInput, formatUsPhoneInput, US_STATES, VERTICAL_OPTIONS,
} from "../../lib/brandFormOptions";
import { getJson } from "../../lib/adminApi";

type BillingStatus = {
	subscription: { name: string; status: string } | null;
	subscriptionError?: string;
	wallet: { balanceMicrodollars: number; currency: string; hasPaymentMethod: boolean } | null;
	walletError?: string;
};

type BrandState = {
	id: string;
	carrierId: string | null;
	status: string | null;
	syncedAt: string | null;
} | null;

type AccountLinkState =
	| { linked: false }
	| {
			linked: true;
			apiKeyLast4: string;
			groupId: string;
			subgroupId: string;
			verifiedAt: string;
			smsCostPerSegmentCents: number | null;
			brand: BrandState;
			billingStatus?: BillingStatus;
			billingPortalUrl?: string;
	  };

type BrandFormState = {
	legalCompanyName: string;
	dba: string;
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
	website: string;
};

const EMPTY_BRAND_FORM: BrandFormState = {
	legalCompanyName: "", dba: "", entityType: DEFAULT_ENTITY_TYPE, country: DEFAULT_COUNTRY,
	ein: "", street: "", city: "", state: "", postalCode: "", firstName: "", lastName: "",
	email: "", phone: "", vertical: DEFAULT_VERTICAL, website: "",
};

const STATUS_BADGE_COLOR: Record<string, "green" | "red" | "orange" | "grey"> = {
	VERIFIED: "green",
	VETTED_VERIFIED: "green",
	UNVERIFIED: "orange",
	PENDING_APPROVAL: "orange",
	PENDING_CREATION: "orange",
	REJECTED: "red",
	PENDING_DELETE: "grey",
	DELETED: "grey",
};

/**
 * The Signal House admin settings/onboarding page: connect an account and register a 10DLC brand.
 * @returns {JSX.Element} The page.
 */
const SignalHouseSettingsPage = () => {
	const [loading, setLoading] = useState(true);
	const [accountLink, setAccountLink] = useState<AccountLinkState>({ linked: false });
	const [apiKeyInput, setApiKeyInput] = useState("");
	const [connecting, setConnecting] = useState(false);
	const [brandForm, setBrandForm] = useState<BrandFormState>(EMPTY_BRAND_FORM);
	const [submittingBrand, setSubmittingBrand] = useState(false);
	const [refreshingBrand, setRefreshingBrand] = useState(false);
	const [costPerSegmentInput, setCostPerSegmentInput] = useState("");
	const [savingCost, setSavingCost] = useState(false);

	/**
	 * Loads this install's connection/brand status from the settings route.
	 * @async
	 * @returns {Promise<void>}
	 */
	async function loadStatus() {
		setLoading(true);
		try {
			const status = await getJson<AccountLinkState>("/admin/signalhouse/settings?includeBilling=1");
			setAccountLink(status);
			if (status.linked) {
				setCostPerSegmentInput(status.smsCostPerSegmentCents != null ? String(status.smsCostPerSegmentCents) : "");
			}
		} catch (err) {
			toast.error("Could not load Signal House settings", { description: (err as Error).message });
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		loadStatus();
	}, []);

	/**
	 * Saves the merchant's per-segment SMS cost assumption, used by the analytics page's ROI panel.
	 * @async
	 * @returns {Promise<void>}
	 */
	async function handleSaveCostPerSegment() {
		const trimmed = costPerSegmentInput.trim();
		const cents = trimmed === "" ? null : Number(trimmed);
		if (cents !== null && (!Number.isInteger(cents) || cents < 0)) {
			toast.error("Cost per segment must be a whole, non-negative number of cents");
			return;
		}

		setSavingCost(true);
		try {
			const status = await getJson<AccountLinkState>("/admin/signalhouse/settings", {
				method: "PUT",
				body: JSON.stringify({ smsCostPerSegmentCents: cents }),
			});
			setAccountLink(status);
			toast.success("Pricing saved");
		} catch (err) {
			toast.error("Could not save pricing", { description: (err as Error).message });
		} finally {
			setSavingCost(false);
		}
	}

	/**
	 * Submits the pasted API key to connect (or re-connect) this install's Signal House account.
	 * @async
	 * @returns {Promise<void>}
	 */
	async function handleConnect() {
		if (!apiKeyInput.trim()) return;
		setConnecting(true);
		try {
			const status = await getJson<AccountLinkState>("/admin/signalhouse/settings", {
				method: "POST",
				body: JSON.stringify({ apiKey: apiKeyInput.trim() }),
			});
			setAccountLink(status);
			setApiKeyInput("");
			toast.success("Connected to Signal House");
		} catch (err) {
			toast.error("Could not connect", { description: (err as Error).message });
		} finally {
			setConnecting(false);
		}
	}

	/**
	 * Submits the brand form for 10DLC registration.
	 * @async
	 * @returns {Promise<void>}
	 */
	async function handleSubmitBrand() {
		setSubmittingBrand(true);
		try {
			const status = await getJson<AccountLinkState>("/admin/signalhouse/brand", {
				method: "POST",
				body: JSON.stringify(brandForm),
			});
			setAccountLink(status);
			toast.success("Brand submitted for review");
		} catch (err) {
			toast.error("Could not submit brand", { description: (err as Error).message });
		} finally {
			setSubmittingBrand(false);
		}
	}

	/**
	 * Re-reads the linked brand's current status from Signal House.
	 * @async
	 * @returns {Promise<void>}
	 */
	async function handleRefreshStatus() {
		setRefreshingBrand(true);
		try {
			const status = await getJson<AccountLinkState>("/admin/signalhouse/brand/refresh", { method: "POST" });
			setAccountLink(status);
		} catch (err) {
			toast.error("Could not refresh status", { description: (err as Error).message });
		} finally {
			setRefreshingBrand(false);
		}
	}

	/**
	 * Updates one field of the brand form.
	 * @param {K} field - The field to update.
	 * @param {BrandFormState[K]} value - Its new value.
	 * @returns {void}
	 */
	function updateBrandField<K extends keyof BrandFormState>(field: K, value: BrandFormState[K]) {
		setBrandForm((prev) => ({ ...prev, [field]: value }));
	}

	if (loading) {
		return (
			<Container>
				<Text>Loading...</Text>
			</Container>
		);
	}

	return (
		<div className="flex flex-col gap-y-4">
			<Container className="flex flex-col gap-y-4">
				<Heading level="h1">Signal House</Heading>

				{accountLink.linked ? (
					<div className="flex flex-col gap-y-2">
						<Text>
							Connected — API key ending in <Badge>...{accountLink.apiKeyLast4}</Badge>
						</Text>
						<Text size="small" className="text-ui-fg-subtle">
							Group {accountLink.groupId} · Subgroup {accountLink.subgroupId}
						</Text>
						<div className="flex items-center gap-x-2 pt-2">
							<Input
								type="password"
								placeholder="Paste a different API key to change it"
								value={apiKeyInput}
								onChange={(e) => setApiKeyInput(e.target.value)}
							/>
							<Button variant="secondary" onClick={handleConnect} disabled={connecting || !apiKeyInput.trim()}>
								{connecting ? "Connecting..." : "Change key"}
							</Button>
						</div>
					</div>
				) : (
					<div className="flex flex-col gap-y-2">
						<Text>Paste your Signal House API key to connect this store to your account.</Text>
						<div className="flex items-center gap-x-2">
							<Input
								type="password"
								placeholder="Signal House API key"
								value={apiKeyInput}
								onChange={(e) => setApiKeyInput(e.target.value)}
							/>
							<Button onClick={handleConnect} disabled={connecting || !apiKeyInput.trim()}>
								{connecting ? "Connecting..." : "Connect"}
							</Button>
						</div>
					</div>
				)}
			</Container>

			{accountLink.linked && <BillingStatusSection accountLink={accountLink} />}

			{accountLink.linked && (
				<Container className="flex flex-col gap-y-4">
					<div className="flex items-center justify-between">
						<Heading level="h2">Brand registration (10DLC)</Heading>
						{accountLink.brand && (
							<div className="flex items-center gap-x-2">
								<StatusBadge color={STATUS_BADGE_COLOR[accountLink.brand.status || ""] || "grey"}>
									{accountLink.brand.status || "UNKNOWN"}
								</StatusBadge>
								<Button variant="secondary" size="small" onClick={handleRefreshStatus} disabled={refreshingBrand}>
									{refreshingBrand ? "Refreshing..." : "Refresh status"}
								</Button>
							</div>
						)}
					</div>

					{accountLink.brand ? (
						<Text size="small" className="text-ui-fg-subtle">
							Submitted — Brand ID {accountLink.brand.carrierId || "pending carrier assignment"}
						</Text>
					) : (
						<div className="grid grid-cols-2 gap-4">
							<Field label="Legal company name">
								<Input value={brandForm.legalCompanyName} onChange={(e) => updateBrandField("legalCompanyName", e.target.value)} />
							</Field>
							<Field label="Brand name (if different)">
								<Input value={brandForm.dba} onChange={(e) => updateBrandField("dba", e.target.value)} />
							</Field>
							<Field label="Entity type">
								<Select value={brandForm.entityType} onValueChange={(v) => updateBrandField("entityType", v as BrandFormState["entityType"])}>
									<Select.Trigger><Select.Value /></Select.Trigger>
									<Select.Content>
										{ENTITY_TYPE_OPTIONS.map((o) => <Select.Item key={o.value} value={o.value}>{o.label}</Select.Item>)}
									</Select.Content>
								</Select>
							</Field>
							<Field label="Country">
								<Select value={brandForm.country} onValueChange={(v) => updateBrandField("country", v)}>
									<Select.Trigger><Select.Value /></Select.Trigger>
									<Select.Content>
										{COUNTRY_OPTIONS.map((o) => <Select.Item key={o.value} value={o.value}>{o.label}</Select.Item>)}
									</Select.Content>
								</Select>
							</Field>
							<Field label="EIN">
								<Input value={brandForm.ein} onChange={(e) => updateBrandField("ein", formatEinInput(e.target.value))} />
							</Field>
							<Field label="Website">
								<Input value={brandForm.website} onChange={(e) => updateBrandField("website", e.target.value)} />
							</Field>
							<Field label="Street address">
								<Input value={brandForm.street} onChange={(e) => updateBrandField("street", e.target.value)} />
							</Field>
							<Field label="City">
								<Input value={brandForm.city} onChange={(e) => updateBrandField("city", e.target.value)} />
							</Field>
							<Field label="State">
								{brandForm.country === "US" ? (
									<Select value={brandForm.state} onValueChange={(v) => updateBrandField("state", v)}>
										<Select.Trigger><Select.Value placeholder="Select a state" /></Select.Trigger>
										<Select.Content>
											{US_STATES.map((s) => <Select.Item key={s} value={s}>{s}</Select.Item>)}
										</Select.Content>
									</Select>
								) : (
									<Input value={brandForm.state} onChange={(e) => updateBrandField("state", e.target.value)} />
								)}
							</Field>
							<Field label="Postal code">
								<Input value={brandForm.postalCode} onChange={(e) => updateBrandField("postalCode", e.target.value)} />
							</Field>
							<Field label="Industry">
								<Select value={brandForm.vertical} onValueChange={(v) => updateBrandField("vertical", v)}>
									<Select.Trigger><Select.Value /></Select.Trigger>
									<Select.Content>
										{VERTICAL_OPTIONS.map((o) => <Select.Item key={o.value} value={o.value}>{o.label}</Select.Item>)}
									</Select.Content>
								</Select>
							</Field>
							<Field label="Contact first name">
								<Input value={brandForm.firstName} onChange={(e) => updateBrandField("firstName", e.target.value)} />
							</Field>
							<Field label="Contact last name">
								<Input value={brandForm.lastName} onChange={(e) => updateBrandField("lastName", e.target.value)} />
							</Field>
							<Field label="Contact email">
								<Input type="email" value={brandForm.email} onChange={(e) => updateBrandField("email", e.target.value)} />
							</Field>
							<Field label="Contact phone">
								<Input value={brandForm.phone} onChange={(e) => updateBrandField("phone", formatUsPhoneInput(e.target.value))} />
							</Field>

							<div className="col-span-2 flex justify-end">
								<Button onClick={handleSubmitBrand} disabled={submittingBrand}>
									{submittingBrand ? "Submitting..." : "Submit for review"}
								</Button>
							</div>
						</div>
					)}
				</Container>
			)}

			{accountLink.linked && (
				<Container className="flex flex-col gap-y-4">
					<Heading level="h2">Broadcast ROI pricing</Heading>
					<Text size="small" className="text-ui-fg-subtle">
						Signal House doesn't bill through this store yet, so the Analytics page's ROI figure needs a
						cost assumption from you. Set what one SMS segment costs to see ROI there — leave blank to
						hide it.
					</Text>
					<div className="flex items-end gap-x-2">
						<Field label="Cost per segment (in cents)">
							<Input
								type="number"
								min={0}
								step={1}
								placeholder="e.g. 1"
								value={costPerSegmentInput}
								onChange={(e) => setCostPerSegmentInput(e.target.value)}
								className="w-40"
							/>
						</Field>
						<Button variant="secondary" onClick={handleSaveCostPerSegment} disabled={savingCost}>
							{savingCost ? "Saving..." : "Save"}
						</Button>
					</div>
				</Container>
			)}
		</div>
	);
};

/**
 * Formats a wallet balance (in microdollars) using its own currency code — the wallet response
 * always carries one, unlike the analytics page's order-total figures, so this never needs a
 * bare-number fallback path for a missing code, only for a currency code `Intl` doesn't recognize.
 * @param {number} microdollars - The balance, in microdollars (1,000,000 = one unit of `currency`).
 * @param {string} currency - The wallet's own currency code (e.g. "USD").
 * @returns {string} The formatted balance.
 */
function formatWalletBalance(microdollars: number, currency: string): string {
	const amount = microdollars / 1_000_000;
	try {
		return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
	} catch {
		return `${amount.toFixed(2)} ${currency}`;
	}
}

/**
 * Shows this account's live Signal House subscription/wallet status, with a warning
 * and a link out to the portal's own billing page when there's no active plan or no payment method
 * on file. Medusa never handles the merchant's plan or payment method itself — signalhouse.io
 * already does, so this only surfaces state and links out rather than reimplementing plan
 * selection or card entry here.
 * @param {Object} props
 * @param {Extract<AccountLinkState, { linked: true }>} props.accountLink - The linked account,
 *   including its (optionally present) `billingStatus`/`billingPortalUrl`.
 * @returns {JSX.Element} The billing status section.
 */
/**
 * Shows this account's live Signal House subscription/wallet status. Distinguishes three states per
 * field — present, confirmed absent, and unknown (the read itself failed) — rather than collapsing
 * "no plan" and "couldn't check" into the same UI, so a transient read failure never tells a
 * merchant on an active plan that they have none.
 * @param {Object} props
 * @param {Extract<AccountLinkState, { linked: true }>} props.accountLink - The linked account,
 *   including its (optionally present) `billingStatus`/`billingPortalUrl`.
 * @returns {JSX.Element} The billing status section.
 */
function BillingStatusSection({ accountLink }: { accountLink: Extract<AccountLinkState, { linked: true }> }) {
	const status = accountLink.billingStatus;
	const portalUrl = accountLink.billingPortalUrl;

	// "unknown" (the read failed, or hasn't happened at all) is deliberately never treated as a
	// confirmed negative — only a genuine, error-free absence should trigger the warning below.
	const subscriptionAbsent = !!status && !status.subscription && !status.subscriptionError;
	const walletUnknown = !status?.wallet;
	const needsAttention = subscriptionAbsent || (!walletUnknown && !status!.wallet!.hasPaymentMethod);

	return (
		<Container className="flex flex-col gap-y-4">
			<Heading level="h2">Billing</Heading>

			{status?.subscription ? (
				<Text size="small">
					Plan: <Badge>{status.subscription.name}</Badge> ({status.subscription.status})
				</Text>
			) : status?.subscriptionError ? (
				<Text size="small" className="text-ui-fg-subtle">
					Could not check subscription status: {status.subscriptionError}
				</Text>
			) : subscriptionAbsent ? (
				<Text size="small" className="text-ui-fg-subtle">
					No active Signal House plan.
				</Text>
			) : (
				<Text size="small" className="text-ui-fg-subtle">
					Checking subscription status...
				</Text>
			)}

			{status?.wallet ? (
				<Text size="small" className="text-ui-fg-subtle">
					Wallet balance: {formatWalletBalance(status.wallet.balanceMicrodollars, status.wallet.currency)} ·{" "}
					{status.wallet.hasPaymentMethod ? "Payment method on file" : "No payment method on file"}
				</Text>
			) : (
				<Text size="small" className="text-ui-fg-subtle">
					{status?.walletError ? `Could not check wallet status: ${status.walletError}` : "Checking wallet status..."}
				</Text>
			)}

			{needsAttention && portalUrl && (
				<InlineTip label="Action needed at Signal House" variant="warning">
					Medusa doesn't bill you directly — your Signal House account needs an active plan and a
					payment method for sends to keep working.{" "}
					<a href={`${portalUrl}/settings/billing`} target="_blank" rel="noreferrer">
						Manage your plan and payment method
					</a>
					.
				</InlineTip>
			)}
		</Container>
	);
}

/**
 * A labeled form field wrapper for the brand registration grid.
 * @param {Object} props
 * @param {string} props.label - The field's label.
 * @param {React.ReactNode} props.children - The field's input control.
 * @returns {JSX.Element} The labeled field.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-y-1">
			<Label size="small">{label}</Label>
			{children}
		</div>
	);
}

export const config = defineRouteConfig({
	label: "Signal House",
	icon: ChatBubbleLeftRight,
});

export default SignalHouseSettingsPage;
