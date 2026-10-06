import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ChartBar } from "@medusajs/icons";
import { Container, Heading, Select, Text, toast } from "@medusajs/ui";
import { getJson } from "../../../lib/adminApi";

type DeliverySummary = {
	sent: number;
	delivered: number;
	failed: number;
	pending: number;
	deliveryRate: number | null;
};

type AttributionSummary = {
	since: string;
	cartSaveRate: { sent: number; converted: number; cartSaveRate: number | null };
	revenueAttribution: { sent: number; converted: number; revenueAttributed: number };
	roi: number | null;
};

type StoreListResponse = { stores: Array<{ supported_currencies?: Array<{ currency_code: string; is_default: boolean }> }> };

const WINDOW_OPTIONS = [
	{ value: "30", label: "Last 30 days" },
	{ value: "90", label: "Last 90 days" },
	{ value: "365", label: "Last 12 months" },
];

/**
 * Formats a 0-1 rate as a percentage string, or an em dash when there's nothing to compute it
 * from — the routes behind this page return `null` (not `0`) for exactly that case, so this must
 * not coerce `null` into "0%", which would misleadingly read as "everything failed."
 * @param {number | null} rate - The rate to format.
 * @returns {string} The formatted percentage, or "—".
 */
function formatRate(rate: number | null): string {
	return rate == null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

/**
 * Formats an amount using the store's own default currency when known, or a bare number when it
 * isn't — `revenueAttributed` is a sum of order totals in whatever currency each order was placed
 * in (`subscribers/order-attribution.ts` records it, with no currency code alongside it), so a
 * hardcoded "$" would mislabel the figure for any non-USD store and silently mix currencies on a
 * multi-currency one. This is a best-effort single-currency label, not a real conversion — the
 * multi-currency case is a pre-existing, documented limitation of `converted_amount_cents` itself.
 * @param {number} amount - The amount in the store's currency major unit.
 * @param {string | null} currencyCode - The store's default currency code, or null if unknown.
 * @returns {string} The formatted amount.
 */
function formatCurrency(amount: number, currencyCode: string | null): string {
	if (!currencyCode) {
		return amount.toFixed(2);
	}
	try {
		return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(amount);
	} catch {
		return amount.toFixed(2);
	}
}

/**
 * The Signal House analytics dashboard: delivery rate, cart-save rate and revenue attribution, and
 * ROI (using the merchant-set cost-per-segment on the Settings page). All 4 panels read existing admin routes — this page has no logic of its own beyond
 * fetching and formatting.
 * @returns {JSX.Element} The page.
 */
const SignalHouseAnalyticsPage = () => {
	const [windowDays, setWindowDays] = useState("90");
	const [loading, setLoading] = useState(true);
	const [delivery, setDelivery] = useState<DeliverySummary | null>(null);
	const [attribution, setAttribution] = useState<AttributionSummary | null>(null);
	const [currencyCode, setCurrencyCode] = useState<string | null>(null);

	useEffect(() => {
		getJson<StoreListResponse>("/admin/stores?limit=1")
			.then((result) => {
				const defaultCurrency = result.stores[0]?.supported_currencies?.find((c) => c.is_default);
				setCurrencyCode(defaultCurrency?.currency_code ?? null);
			})
			.catch(() => setCurrencyCode(null));
	}, []);

	useEffect(() => {
		// The 30-day and 365-day windows cost very differently to compute (both routes scan
		// `message_log` over the window), so a slower older request can resolve after a faster
		// newer one and overwrite it with stale numbers under the current window's label — this
		// flag drops any response that isn't from the most recently fired effect.
		let cancelled = false;
		const since = new Date(Date.now() - Number(windowDays) * 24 * 60 * 60 * 1000).toISOString();
		setLoading(true);
		Promise.all([
			getJson<DeliverySummary>(`/admin/signalhouse/analytics/delivery?since=${since}`),
			getJson<AttributionSummary>(`/admin/signalhouse/analytics/attribution?since=${since}`),
		])
			.then(([deliveryResult, attributionResult]) => {
				if (cancelled) return;
				setDelivery(deliveryResult);
				setAttribution(attributionResult);
			})
			.catch((err) => {
				if (!cancelled) toast.error("Could not load analytics", { description: (err as Error).message });
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [windowDays]);

	return (
		<div className="flex flex-col gap-y-4">
			<Container className="flex items-center justify-between">
				<Heading level="h1">Analytics</Heading>
				<Select value={windowDays} onValueChange={setWindowDays}>
					<Select.Trigger className="w-48">
						<Select.Value />
					</Select.Trigger>
					<Select.Content>
						{WINDOW_OPTIONS.map((option) => (
							<Select.Item key={option.value} value={option.value}>{option.label}</Select.Item>
						))}
					</Select.Content>
				</Select>
			</Container>

			{loading ? (
				<Container><Text>Loading...</Text></Container>
			) : (
				<div className="grid grid-cols-2 gap-4">
					<Panel title="Delivery rate">
						<BigStat value={formatRate(delivery?.deliveryRate ?? null)} />
						<Text size="small" className="text-ui-fg-subtle">
							{delivery?.delivered ?? 0} delivered · {delivery?.failed ?? 0} failed · {delivery?.pending ?? 0} pending
						</Text>
					</Panel>

					<Panel title="Cart-save rate">
						<BigStat value={formatRate(attribution?.cartSaveRate.cartSaveRate ?? null)} />
						<Text size="small" className="text-ui-fg-subtle">
							{attribution?.cartSaveRate.converted ?? 0} of {attribution?.cartSaveRate.sent ?? 0} recovery texts converted
						</Text>
					</Panel>

					<Panel title="Revenue attribution">
						<BigStat value={formatCurrency(attribution?.revenueAttribution.revenueAttributed ?? 0, currencyCode)} />
						<Text size="small" className="text-ui-fg-subtle">
							{attribution?.revenueAttribution.converted ?? 0} of {attribution?.revenueAttribution.sent ?? 0} broadcast sends
							converted — rarely populated until broadcast audiences carry a customer id
						</Text>
					</Panel>

					<Panel title="ROI">
						{attribution?.roi == null ? (
							<>
								<BigStat value="—" />
								<Text size="small" className="text-ui-fg-subtle">
									{(attribution?.revenueAttribution.sent ?? 0) === 0
										? "No marketing sends in this window yet."
										: (
											<>
												Set a cost per segment on the{" "}
												<Link to="/signalhouse" className="underline">Settings page</Link> to see ROI.
											</>
										)}
								</Text>
							</>
						) : (
							<>
								<BigStat value={`${attribution.roi.toFixed(1)}x`} />
								<Text size="small" className="text-ui-fg-subtle">Revenue attributed per dollar spent, using the configured cost per segment</Text>
							</>
						)}
					</Panel>
				</div>
			)}
		</div>
	);
};

/**
 * A titled analytics card.
 * @param {Object} props
 * @param {string} props.title - The panel's title.
 * @param {React.ReactNode} props.children - The panel's content.
 * @returns {JSX.Element} The panel.
 */
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<Container className="flex flex-col gap-y-2">
			<Text size="small" className="text-ui-fg-subtle">{title}</Text>
			{children}
		</Container>
	);
}

/**
 * A large headline stat for an analytics panel.
 * @param {Object} props
 * @param {string} props.value - The stat to display.
 * @returns {JSX.Element} The stat.
 */
function BigStat({ value }: { value: string }) {
	return <Heading level="h1">{value}</Heading>;
}

export const config = defineRouteConfig({
	label: "SH Analytics",
	icon: ChartBar,
});

export default SignalHouseAnalyticsPage;
