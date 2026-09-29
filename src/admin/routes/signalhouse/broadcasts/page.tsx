import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { defineRouteConfig } from "@medusajs/admin-sdk";
import { PaperPlane } from "@medusajs/icons";
import { Button, Container, DatePicker, Heading, InlineTip, Select, StatusBadge, Table, Text, Textarea, toast } from "@medusajs/ui";
import { getJson } from "../../../lib/adminApi";
import { STATUS_BADGE_COLOR, type BroadcastRow } from "../../../lib/broadcastTypes";

type BroadcastListResponse = {
	broadcasts: BroadcastRow[];
	count: number;
	limit: number;
	offset: number;
};

type CustomerGroup = { id: string; name: string };
type CustomerGroupListResponse = { customer_groups: CustomerGroup[]; count: number };

const MAX_MESSAGE_BODY_LENGTH = 1600;
const PAGE_SIZE = 20;
const CUSTOMER_GROUP_FETCH_LIMIT = 1000;
// Radix's Select.Item (which @medusajs/ui's Select wraps) throws at runtime if a value prop is an
// empty string — it reserves "" to mean "no selection" internally. A real, non-empty sentinel is
// required to represent "every consented customer," converted back to `null` only when building
// the create-broadcast request body.
const ALL_CUSTOMERS_VALUE = "__all__";

/**
 * The Signal House broadcasts page: compose a marketing SMS to every consented customer (or one
 * customer group) and see every broadcast's send progress. Sending itself happens on its own
 * schedule in `jobs/broadcast-send.ts` — this page only creates the broadcast and its recipient
 * list (`POST /admin/signalhouse/broadcasts`) and lists what already exists.
 * @returns {JSX.Element} The page.
 */
const SignalHouseBroadcastsPage = () => {
	const [loading, setLoading] = useState(true);
	const [broadcasts, setBroadcasts] = useState<BroadcastRow[]>([]);
	const [count, setCount] = useState(0);
	const [offset, setOffset] = useState(0);
	const [customerGroups, setCustomerGroups] = useState<CustomerGroup[]>([]);
	const [customerGroupsTruncated, setCustomerGroupsTruncated] = useState(false);
	const [sendingEnabled, setSendingEnabled] = useState(true);

	const [messageBody, setMessageBody] = useState("");
	const [customerGroupId, setCustomerGroupId] = useState<string>(ALL_CUSTOMERS_VALUE);
	const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
	const [creating, setCreating] = useState(false);

	/**
	 * Loads one page of broadcasts, most recently created first.
	 * @async
	 * @param {number} newOffset - The page offset to load.
	 * @returns {Promise<void>}
	 */
	async function loadBroadcasts(newOffset: number) {
		setLoading(true);
		try {
			const result = await getJson<BroadcastListResponse>(
				`/admin/signalhouse/broadcasts?limit=${PAGE_SIZE}&offset=${newOffset}`,
			);
			setBroadcasts(result.broadcasts);
			setCount(result.count);
			setOffset(result.offset);
		} catch (err) {
			toast.error("Could not load broadcasts", { description: (err as Error).message });
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		loadBroadcasts(0);

		// Customer-group scoping is optional — if this store has none, or the core admin route
		// shape ever changes, the picker degrades to "every consented customer" rather than
		// blocking broadcast creation entirely.
		getJson<CustomerGroupListResponse>(`/admin/customer-groups?limit=${CUSTOMER_GROUP_FETCH_LIMIT}`)
			.then((result) => {
				setCustomerGroups(result.customer_groups);
				// A store with more customer groups than this page fetches would otherwise show a
				// picker that looks complete while some groups are simply unreachable through it —
				// surfaced rather than hidden (ai-review, PR #1322).
				setCustomerGroupsTruncated(result.count > result.customer_groups.length);
			})
			.catch(() => setCustomerGroups([]));

		getJson<{ broadcastSendingEnabled: boolean }>("/admin/signalhouse/settings")
			.then((result) => setSendingEnabled(result.broadcastSendingEnabled))
			// Fail toward showing the "sending is off" caveat, not hiding it — a fetch failure here
			// must never read as "sending is definitely on."
			.catch(() => setSendingEnabled(false));
	}, []);

	/**
	 * Creates a broadcast from the compose form, then refreshes the list and clears the form.
	 * @async
	 * @returns {Promise<void>}
	 */
	async function handleCreate() {
		const trimmed = messageBody.trim();
		if (!trimmed) return;

		setCreating(true);
		try {
			await getJson("/admin/signalhouse/broadcasts", {
				method: "POST",
				body: JSON.stringify({
					messageBody: trimmed,
					customerGroupId: customerGroupId === ALL_CUSTOMERS_VALUE ? null : customerGroupId,
					scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
				}),
			});
			if (scheduledAt) {
				toast.success("Broadcast scheduled");
			} else if (sendingEnabled) {
				toast.success("Broadcast created — sending starts on the next send cycle");
			} else {
				// Sending is off by default on every install (see the InlineTip above the compose
				// form) — a plain success toast here would tell the merchant sending is imminent
				// when it isn't, and nothing else in this UI would ever correct that impression
				// (ai-review, PR #1322).
				toast.warning("Broadcast created, but broadcast sending is currently disabled — it will stay queued until an admin enables it.");
			}
			setMessageBody("");
			setCustomerGroupId(ALL_CUSTOMERS_VALUE);
			setScheduledAt(null);
			await loadBroadcasts(0);
		} catch (err) {
			toast.error("Could not create that broadcast", { description: (err as Error).message });
		} finally {
			setCreating(false);
		}
	}

	const pageCount = Math.max(Math.ceil(count / PAGE_SIZE), 1);
	const pageIndex = Math.floor(offset / PAGE_SIZE);

	return (
		<div className="flex flex-col gap-y-4">
			<Container className="flex flex-col gap-y-4">
				<Heading level="h1">Broadcasts</Heading>

				{!sendingEnabled && (
					<InlineTip label="Sending is disabled" variant="warning">
						Broadcasts created here will queue but won't send until an admin sets
						SIGNALHOUSE_MARKETING_BROADCAST_ENABLED=true (off by default on every install).
					</InlineTip>
				)}

				<div className="flex flex-col gap-y-2">
					<Textarea
						placeholder="Message to send..."
						value={messageBody}
						onChange={(e) => setMessageBody(e.target.value.slice(0, MAX_MESSAGE_BODY_LENGTH))}
						rows={3}
					/>
					<Text size="small" className="text-ui-fg-subtle">
						{messageBody.length} / {MAX_MESSAGE_BODY_LENGTH}
					</Text>
				</div>

				<div className="flex items-end gap-x-4">
					<div className="flex flex-col gap-y-1">
						<Text size="small" className="text-ui-fg-subtle">Audience</Text>
						<Select value={customerGroupId} onValueChange={setCustomerGroupId}>
							<Select.Trigger className="w-64">
								<Select.Value placeholder="Every consented customer" />
							</Select.Trigger>
							<Select.Content>
								<Select.Item value={ALL_CUSTOMERS_VALUE}>Every consented customer</Select.Item>
								{customerGroups.map((group) => (
									<Select.Item key={group.id} value={group.id}>{group.name}</Select.Item>
								))}
							</Select.Content>
						</Select>
						{customerGroupsTruncated && (
							<Text size="xsmall" className="text-ui-tag-orange-text">
								This store has more customer groups than fit here — some may be missing.
							</Text>
						)}
					</div>

					<div className="flex flex-col gap-y-1">
						<Text size="small" className="text-ui-fg-subtle">Send time</Text>
						<DatePicker
							value={scheduledAt}
							onChange={setScheduledAt}
							granularity="minute"
							minValue={new Date()}
						/>
					</div>

					<Button onClick={handleCreate} disabled={creating || !messageBody.trim()}>
						{creating ? "Saving..." : scheduledAt ? "Schedule" : sendingEnabled ? "Send now" : "Queue (sending disabled)"}
					</Button>
				</div>
			</Container>

			<Container className="flex flex-col gap-y-4">
				<Heading level="h2">All broadcasts</Heading>

				{loading ? (
					<Text>Loading...</Text>
				) : broadcasts.length === 0 ? (
					<Text className="text-ui-fg-subtle">No broadcasts yet.</Text>
				) : (
					<Table>
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell>Message</Table.HeaderCell>
								<Table.HeaderCell>Status</Table.HeaderCell>
								<Table.HeaderCell>Recipients</Table.HeaderCell>
								<Table.HeaderCell>Sent</Table.HeaderCell>
								<Table.HeaderCell>Failed</Table.HeaderCell>
								<Table.HeaderCell>Scheduled / sent at</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{broadcasts.map((broadcast) => (
								<Table.Row key={broadcast.id}>
									<Table.Cell className="max-w-xs truncate">
										<Link to={`/signalhouse/broadcasts/${broadcast.id}`} className="hover:underline">
											{broadcast.messageBody}
										</Link>
									</Table.Cell>
									<Table.Cell>
										<StatusBadge color={STATUS_BADGE_COLOR[broadcast.status]}>{broadcast.status}</StatusBadge>
									</Table.Cell>
									<Table.Cell>{broadcast.recipientCount}</Table.Cell>
									<Table.Cell>{broadcast.sentCount}</Table.Cell>
									<Table.Cell>{broadcast.failedCount}</Table.Cell>
									<Table.Cell>
										{broadcast.sentAt
											? new Date(broadcast.sentAt).toLocaleString()
											: broadcast.scheduledAt
												? new Date(broadcast.scheduledAt).toLocaleString()
												: "—"}
									</Table.Cell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				)}

				{count > PAGE_SIZE && (
					<Table.Pagination
						count={count}
						pageSize={PAGE_SIZE}
						pageIndex={pageIndex}
						pageCount={pageCount}
						canPreviousPage={pageIndex > 0}
						canNextPage={pageIndex < pageCount - 1}
						previousPage={() => loadBroadcasts(Math.max(offset - PAGE_SIZE, 0))}
						nextPage={() => loadBroadcasts(offset + PAGE_SIZE)}
					/>
				)}
			</Container>
		</div>
	);
};

export const config = defineRouteConfig({
	label: "SH Broadcasts",
	icon: PaperPlane,
});

export default SignalHouseBroadcastsPage;
