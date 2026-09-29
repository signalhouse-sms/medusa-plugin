import { test } from "node:test";
import assert from "node:assert/strict";
import BroadcastModuleService from "./service";

// Same technique as `message-log/service.test.ts`: bypass the MedusaService/DB base entirely and
// hand-stub the auto-generated CRUD/count methods, for both models this service manages.
function buildService(broadcasts: any[], recipients: any[] = []) {
	const service = Object.create(BroadcastModuleService.prototype) as any;
	const createdBroadcasts: any[] = [];
	const createdRecipients: any[] = [];
	const deletedBroadcastIds = new Set<string>();
	const deletedRecipientIds = new Set<string>();

	function allBroadcasts() {
		return [...broadcasts, ...createdBroadcasts].filter((b) => !deletedBroadcastIds.has(b.id));
	}
	function allRecipients() {
		return [...recipients, ...createdRecipients].filter((r) => !deletedRecipientIds.has(r.id));
	}
	function matches(row: any, filters: any) {
		for (const key of Object.keys(filters)) {
			if (key === "scheduled_at" && filters[key]?.$lte) {
				if (!(row.scheduled_at && row.scheduled_at <= filters[key].$lte)) return false;
				continue;
			}
			if (row[key] !== filters[key]) return false;
		}
		return true;
	}

	service.listBroadcasts = async (filters: any = {}) => allBroadcasts().filter((b) => matches(b, filters));
	service.listAndCountBroadcasts = async (filters: any = {}) => {
		const rows = allBroadcasts().filter((b) => matches(b, filters));
		return [rows, rows.length];
	};
	service.createBroadcasts = async (data: any) => {
		const record = { id: `bcast_created_${createdBroadcasts.length}`, ...data };
		createdBroadcasts.push(record);
		return record;
	};
	service.updateBroadcasts = async (updates: any[]) => {
		return updates.map((update) => {
			const existing = allBroadcasts().find((b) => b.id === update.id) || {};
			return { ...existing, ...update };
		});
	};
	service.deleteBroadcasts = async (ids: string[]) => {
		ids.forEach((id) => deletedBroadcastIds.add(id));
	};

	service.listBroadcastRecipients = async (filters: any = {}, config: any = {}) => {
		const rows = allRecipients().filter((r) => matches(r, filters));
		return config.take ? rows.slice(0, config.take) : rows;
	};
	service.listAndCountBroadcastRecipients = async (filters: any = {}) => {
		const rows = allRecipients().filter((r) => matches(r, filters));
		return [rows, rows.length];
	};
	service.createBroadcastRecipients = async (data: any[]) => {
		const created = data.map((d, i) => ({ id: `recip_created_${createdRecipients.length + i}`, ...d }));
		createdRecipients.push(...created);
		return created;
	};
	service.updateBroadcastRecipients = async (updates: any[]) => {
		return updates.map((update) => {
			const existing = allRecipients().find((r) => r.id === update.id) || {};
			return { ...existing, ...update };
		});
	};
	service.deleteBroadcastRecipients = async (ids: string[]) => {
		ids.forEach((id) => deletedRecipientIds.add(id));
	};

	return service as BroadcastModuleService;
}

test("createBroadcastWithRecipients marks a zero-recipient audience already sent, not sending", async () => {
	const service = buildService([]);
	const broadcast: any = await service.createBroadcastWithRecipients({
		messageBody: "hi", customerGroupId: null, scheduledAt: null, recipients: [],
	});
	assert.equal(broadcast.status, "sent");
	assert.ok(broadcast.sent_at instanceof Date);
	assert.equal(broadcast.recipient_count, 0);
});

test("createBroadcastWithRecipients schedules a future scheduledAt instead of sending immediately", async () => {
	const service = buildService([]);
	const future = new Date(Date.now() + 60_000);
	const broadcast: any = await service.createBroadcastWithRecipients({
		messageBody: "hi", customerGroupId: null, scheduledAt: future,
		recipients: [{ phoneNumber: "5555550100", customerId: "cus_1" }],
	});
	assert.equal(broadcast.status, "scheduled");
	assert.equal(broadcast.sent_at, null);
	assert.equal(broadcast.recipient_count, 1);
});

test("createBroadcastWithRecipients sends immediately when scheduledAt is omitted", async () => {
	const service = buildService([]);
	const broadcast: any = await service.createBroadcastWithRecipients({
		messageBody: "hi", customerGroupId: null, scheduledAt: null,
		recipients: [{ phoneNumber: "5555550100", customerId: null }, { phoneNumber: "5555550101", customerId: null }],
	});
	assert.equal(broadcast.status, "sending");
	assert.equal(broadcast.recipient_count, 2);
});

test("createBroadcastWithRecipients starts every recipient at zero attempts", async () => {
	const service = buildService([]);
	await service.createBroadcastWithRecipients({
		messageBody: "hi", customerGroupId: null, scheduledAt: null,
		recipients: [{ phoneNumber: "5555550100", customerId: null }],
	});
	const [recipient]: any = await service.listBroadcastRecipients({ broadcast_id: "bcast_created_0" });
	assert.equal(recipient.attempts, 0);
	assert.equal(recipient.status, "pending");
});

test("listDueBroadcasts returns scheduled-and-due plus already-sending, not future-scheduled", async () => {
	const now = new Date("2026-09-05T12:00:00Z");
	const service = buildService([
		{ id: "1", status: "scheduled", scheduled_at: new Date("2026-09-05T11:00:00Z") },
		{ id: "2", status: "scheduled", scheduled_at: new Date("2026-09-05T13:00:00Z") },
		{ id: "3", status: "sending", scheduled_at: null },
		{ id: "4", status: "sent", scheduled_at: null },
	]);
	const due = await service.listDueBroadcasts(now);
	assert.deepEqual(due.map((b: any) => b.id).sort(), ["1", "3"]);
});

test("recordRecipientOutcome marks a recipient sent and clears any prior failure reason", async () => {
	const service: any = buildService([], [{ id: "r1", broadcast_id: "1", status: "sending", failure_reason: "landline" }]);
	const updated: any = await service.recordRecipientOutcome("r1", { status: "sent" });
	assert.equal(updated.status, "sent");
	assert.equal(updated.failure_reason, null);
});

test("recordRecipientOutcome marks a recipient terminally failed with its reason", async () => {
	const service: any = buildService([], [{ id: "r1", broadcast_id: "1", status: "sending", attempts: 3 }]);
	const updated: any = await service.recordRecipientOutcome("r1", { status: "failed", failureReason: "revoked" });
	assert.equal(updated.status, "failed");
	assert.equal(updated.failure_reason, "revoked");
});

test("recordRecipientRetry reverts a claimed recipient back to pending with the new attempt count", async () => {
	const service: any = buildService([], [{ id: "r1", broadcast_id: "1", status: "sending", attempts: 0 }]);
	const updated: any = await service.recordRecipientRetry("r1", 1, "provider timeout");
	assert.equal(updated.status, "pending");
	assert.equal(updated.attempts, 1);
	assert.equal(updated.failure_reason, "provider timeout");
});

test("deleteBroadcastWithRecipients removes the broadcast and every one of its recipients", async () => {
	const service: any = buildService(
		[{ id: "1", status: "sending" }],
		[{ id: "r1", broadcast_id: "1", status: "pending" }, { id: "r2", broadcast_id: "1", status: "pending" }],
	);
	await service.deleteBroadcastWithRecipients("1");
	assert.deepEqual(await service.listBroadcasts({ id: "1" }), []);
	assert.deepEqual(await service.listBroadcastRecipients({ broadcast_id: "1" }), []);
});

test("createBroadcastWithRecipients stays draft until every recipient has committed", async () => {
	const service: any = buildService([]);
	let statusWhileRecipientsWereInserting: string | undefined;
	const originalCreateRecipients = service.createBroadcastRecipients.bind(service);
	service.createBroadcastRecipients = async (data: any[]) => {
		const [broadcast] = await service.listBroadcasts({ id: "bcast_created_0" });
		statusWhileRecipientsWereInserting = broadcast.status;
		return originalCreateRecipients(data);
	};

	const broadcast: any = await service.createBroadcastWithRecipients({
		messageBody: "hi", customerGroupId: null, scheduledAt: null,
		recipients: [{ phoneNumber: "5555550100", customerId: null }],
	});

	assert.equal(statusWhileRecipientsWereInserting, "draft");
	assert.equal(broadcast.status, "sending");
});

test("createBroadcastWithRecipients deletes the broadcast if the recipient insert fails, leaving no orphan", async () => {
	const service: any = buildService([]);
	service.createBroadcastRecipients = async () => {
		throw new Error("insert failed");
	};

	await assert.rejects(
		() => service.createBroadcastWithRecipients({
			messageBody: "hi", customerGroupId: null, scheduledAt: null,
			recipients: [{ phoneNumber: "5555550100", customerId: null }],
		}),
		/insert failed/,
	);
	assert.deepEqual(await service.listBroadcasts({ id: "bcast_created_0" }), []);
});
