import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "@medusajs/icons";
import { Container, Heading, StatusBadge, Text, toast } from "@medusajs/ui";
import { getJson } from "../../../../lib/adminApi";
import { STATUS_BADGE_COLOR, type BroadcastRow } from "../../../../lib/broadcastTypes";

/**
 * A single broadcast's detail view — its full message, audience scope, and send progress. No edit
 * or cancel action: a broadcast's audience is resolved once at creation time
 * (`resolve-broadcast-audience.ts`), so there is nothing here that can be safely changed after the
 * fact without re-resolving recipients, which isn't in this phase's scope.
 * @returns {JSX.Element} The page.
 */
const SignalHouseBroadcastDetailPage = () => {
	const { id } = useParams();
	const [loading, setLoading] = useState(true);
	const [broadcast, setBroadcast] = useState<BroadcastRow | null>(null);

	useEffect(() => {
		if (!id) return;
		setLoading(true);
		getJson<BroadcastRow>(`/admin/signalhouse/broadcasts/${id}`)
			.then(setBroadcast)
			.catch((err) => toast.error("Could not load that broadcast", { description: (err as Error).message }))
			.finally(() => setLoading(false));
	}, [id]);

	return (
		<div className="flex flex-col gap-y-4">
			<Link to="/signalhouse/broadcasts" className="flex items-center gap-x-1 text-ui-fg-subtle hover:text-ui-fg-base w-fit">
				<ArrowLeft />
				<Text size="small">Back to broadcasts</Text>
			</Link>

			<Container className="flex flex-col gap-y-4">
				{loading ? (
					<Text>Loading...</Text>
				) : !broadcast ? (
					<Text className="text-ui-fg-subtle">Broadcast not found.</Text>
				) : (
					<>
						<div className="flex items-center justify-between">
							<Heading level="h1">Broadcast</Heading>
							<StatusBadge color={STATUS_BADGE_COLOR[broadcast.status]}>{broadcast.status}</StatusBadge>
						</div>

						<Text>{broadcast.messageBody}</Text>

						<div className="grid grid-cols-2 gap-4 pt-2">
							<Stat label="Audience" value={broadcast.customerGroupId ? `Group ${broadcast.customerGroupId}` : "Every consented customer"} />
							<Stat label="Recipients" value={String(broadcast.recipientCount)} />
							<Stat label="Sent" value={String(broadcast.sentCount)} />
							<Stat label="Failed" value={String(broadcast.failedCount)} />
							<Stat label="Scheduled for" value={broadcast.scheduledAt ? new Date(broadcast.scheduledAt).toLocaleString() : "—"} />
							<Stat label="Sent at" value={broadcast.sentAt ? new Date(broadcast.sentAt).toLocaleString() : "—"} />
						</div>
					</>
				)}
			</Container>
		</div>
	);
};

/**
 * A labeled stat cell for the broadcast detail grid.
 * @param {Object} props
 * @param {string} props.label - The stat's label.
 * @param {string} props.value - The stat's value.
 * @returns {JSX.Element} The labeled stat.
 */
function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col gap-y-1">
			<Text size="small" className="text-ui-fg-subtle">{label}</Text>
			<Text>{value}</Text>
		</div>
	);
}

export default SignalHouseBroadcastDetailPage;
