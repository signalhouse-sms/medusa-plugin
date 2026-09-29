import { test } from "node:test";
import assert from "node:assert/strict";
import MessageLogModuleService from "./service";

// Same technique as `settings/service.test.ts`/`sms-consent/service.test.ts`: bypass the
// MedusaService/DB base entirely and hand-stub the auto-generated CRUD/count methods.
function buildService(rows: any[]) {
	const service = Object.create(MessageLogModuleService.prototype) as any;
	const created: any[] = [];
	const updated: any[] = [];

	function all() {
		return [...rows, ...created];
	}
	function matches(row: any, filters: any) {
		for (const key of Object.keys(filters)) {
			if (key === "sent_at" && filters[key]?.$gte) {
				if (!(row.sent_at >= filters[key].$gte)) return false;
				continue;
			}
			if (filters[key]?.$in) {
				if (!filters[key].$in.includes(row[key])) return false;
				continue;
			}
			if (filters[key] && typeof filters[key] === "object" && "$ne" in filters[key]) {
				if (row[key] === filters[key].$ne) return false;
				continue;
			}
			if (row[key] !== filters[key]) return false;
		}
		return true;
	}

	service.listMessageLogs = async (filters: any = {}) => all().filter((r) => matches(r, filters));
	service.listAndCountMessageLogs = async (filters: any = {}) => {
		const rowsMatched = all().filter((r) => matches(r, filters));
		return [rowsMatched, rowsMatched.length];
	};
	service.createMessageLogs = async (data: any) => {
		const record = { id: `msglog_created_${created.length}`, ...data };
		created.push(record);
		return record;
	};
	service.updateMessageLogs = async (updates: any[]) => {
		return updates.map((update) => {
			const existing = all().find((r) => r.id === update.id) || {};
			const record = { ...existing, ...update };
			updated.push(record);
			return record;
		});
	};

	return service as MessageLogModuleService;
}

test("recordSent creates a row with status sent and no delivery timestamps", async () => {
	const service = buildService([]);
	const record: any = await service.recordSent({
		externalId: "msg_1", phoneNumber: "5555550100", customerId: "cus_1", purpose: "transactional",
	});
	assert.equal(record.external_id, "msg_1");
	assert.equal(record.status, "sent");
	assert.equal(record.delivered_at, null);
	assert.equal(record.failed_at, null);
});

test("recordDelivery returns null when no message with that external_id was logged", async () => {
	const service = buildService([]);
	const result = await service.recordDelivery({ externalId: "msg_unknown", status: "delivered" });
	assert.equal(result, null);
});

test("recordDelivery marks a delivered message and stamps delivered_at", async () => {
	const service = buildService([{ id: "msglog_1", external_id: "msg_1", status: "sent", delivered_at: null, failed_at: null }]);
	const updated: any = await service.recordDelivery({ externalId: "msg_1", status: "delivered", segmentCount: 2 });
	assert.equal(updated.status, "delivered");
	assert.ok(updated.delivered_at instanceof Date);
	assert.equal(updated.failed_at, null);
	assert.equal(updated.segment_count, 2);
});

test("recordDelivery marks a failed message with its reason and stamps failed_at", async () => {
	const service = buildService([{ id: "msglog_1", external_id: "msg_1", status: "sent", delivered_at: null, failed_at: null }]);
	const updated: any = await service.recordDelivery({ externalId: "msg_1", status: "failed", failureReason: "landline" });
	assert.equal(updated.status, "failed");
	assert.equal(updated.failure_reason, "landline");
	assert.ok(updated.failed_at instanceof Date);
	assert.equal(updated.delivered_at, null);
});

test("getDeliverySummary computes deliveryRate over resolved (delivered+failed) messages only", async () => {
	const service = buildService([
		{ id: "1", purpose: "marketing", status: "delivered", sent_at: new Date("2026-01-01") },
		{ id: "2", purpose: "marketing", status: "delivered", sent_at: new Date("2026-01-02") },
		{ id: "3", purpose: "marketing", status: "failed", sent_at: new Date("2026-01-03") },
		{ id: "4", purpose: "marketing", status: "sent", sent_at: new Date("2026-01-04") },
	]);
	const summary = await service.getDeliverySummary();
	assert.equal(summary.sent, 4);
	assert.equal(summary.delivered, 2);
	assert.equal(summary.failed, 1);
	assert.equal(summary.pending, 1);
	assert.equal(summary.deliveryRate, 2 / 3);
});

test("getDeliverySummary returns null deliveryRate when nothing has resolved yet, not a misleading 0", async () => {
	const service = buildService([{ id: "1", purpose: "marketing", status: "sent", sent_at: new Date() }]);
	const summary = await service.getDeliverySummary();
	assert.equal(summary.deliveryRate, null);
});

test("getDeliverySummary filters by purpose", async () => {
	const service = buildService([
		{ id: "1", purpose: "marketing", status: "delivered", sent_at: new Date("2026-01-01") },
		{ id: "2", purpose: "transactional", status: "delivered", sent_at: new Date("2026-01-01") },
	]);
	const summary = await service.getDeliverySummary({ purpose: "marketing" });
	assert.equal(summary.sent, 1);
});

test("getDeliverySummary filters by since", async () => {
	const service = buildService([
		{ id: "1", purpose: "marketing", status: "delivered", sent_at: new Date("2026-01-01") },
		{ id: "2", purpose: "marketing", status: "delivered", sent_at: new Date("2026-02-01") },
	]);
	const summary = await service.getDeliverySummary({ since: new Date("2026-01-15") });
	assert.equal(summary.sent, 1);
});

test("findBroadcastSend finds an existing sent row for the same broadcast and phone number", async () => {
	const service = buildService([
		{ id: "1", broadcast_id: "bcast_1", phone_number: "5555550100", status: "sent" },
	]);
	const found: any = await service.findBroadcastSend("bcast_1", "5555550100");
	assert.equal(found.id, "1");
});

test("findBroadcastSend finds a row that has since progressed to delivered", async () => {
	const service = buildService([
		{ id: "1", broadcast_id: "bcast_1", phone_number: "5555550100", status: "delivered" },
	]);
	const found: any = await service.findBroadcastSend("bcast_1", "5555550100");
	assert.equal(found.id, "1");
});

test("findBroadcastSend finds a row even after a DLR flipped it to failed — the send still happened and was billed", async () => {
	const service = buildService([
		{ id: "1", broadcast_id: "bcast_1", phone_number: "5555550100", status: "failed" },
	]);
	const found: any = await service.findBroadcastSend("bcast_1", "5555550100");
	assert.equal(found.id, "1");
});

test("findBroadcastSend returns null when nothing matches — different broadcast or different phone", async () => {
	const service = buildService([
		{ id: "1", broadcast_id: "bcast_2", phone_number: "5555550100", status: "sent" },
		{ id: "2", broadcast_id: "bcast_1", phone_number: "5555550199", status: "sent" },
	]);
	assert.equal(await service.findBroadcastSend("bcast_1", "5555550100"), null);
});

test("getCartSaveRateSummary computes the rate over converted cart_recovery sends", async () => {
	const service = buildService([
		{ id: "1", purpose: "cart_recovery", sent_at: new Date("2026-01-01"), converted_order_id: "order_1" },
		{ id: "2", purpose: "cart_recovery", sent_at: new Date("2026-01-02"), converted_order_id: null },
		{ id: "3", purpose: "cart_recovery", sent_at: new Date("2026-01-03"), converted_order_id: null },
		{ id: "4", purpose: "marketing", sent_at: new Date("2026-01-01"), converted_order_id: "order_2" },
	]);
	const summary = await service.getCartSaveRateSummary();
	assert.equal(summary.sent, 3);
	assert.equal(summary.converted, 1);
	assert.equal(summary.cartSaveRate, 1 / 3);
});

test("getCartSaveRateSummary returns null rate when nothing has been sent, not a misleading 0", async () => {
	const service = buildService([]);
	const summary = await service.getCartSaveRateSummary();
	assert.equal(summary.cartSaveRate, null);
});

test("getCartSaveRateSummary filters by since", async () => {
	const service = buildService([
		{ id: "1", purpose: "cart_recovery", sent_at: new Date("2026-01-01"), converted_order_id: "order_1" },
		{ id: "2", purpose: "cart_recovery", sent_at: new Date("2026-02-01"), converted_order_id: null },
	]);
	const summary = await service.getCartSaveRateSummary({ since: new Date("2026-01-15") });
	assert.equal(summary.sent, 1);
	assert.equal(summary.converted, 0);
});

