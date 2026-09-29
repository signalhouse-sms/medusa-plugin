import { test } from "node:test";
import assert from "node:assert/strict";
import SettingsModuleService from "./service";

// Same technique as `sms-consent/service.test.ts`: bypass the MedusaService/DB base entirely and
// hand-stub the auto-generated CRUD methods, so these tests exercise only the hand-written logic.
function buildService(rows: any[]) {
	const service = Object.create(SettingsModuleService.prototype) as any;
	const created: any[] = [];
	const updated: any[] = [];

	service.listAccountLinks = async () => [...rows, ...created];
	service.createAccountLinks = async (data: any) => {
		const record = { id: `acclink_created_${created.length}`, ...data };
		created.push(record);
		return record;
	};
	service.updateAccountLinks = async (updates: any[]) => {
		return updates.map((update) => {
			const record = { ...rows[0], ...created[0], ...update };
			updated.push(record);
			return record;
		});
	};

	return service as SettingsModuleService;
}

test("getAccountLink returns null when nothing is linked yet", async () => {
	const service = buildService([]);
	assert.equal(await service.getAccountLink(), null);
});

test("getAccountLink returns the single row when one exists", async () => {
	const service = buildService([{ id: "acclink_1", group_id: "G1" }]);
	const link = await service.getAccountLink();
	assert.equal(link?.id, "acclink_1");
});

test("saveAccountLink creates a row when none exists yet", async () => {
	const service = buildService([]);
	const saved = await service.saveAccountLink({
		apiKeyCiphertext: "ct", apiKeyLast4: "1234", groupId: "G1", subgroupId: "SG1",
	});
	assert.equal(saved.group_id, "G1");
	assert.equal(saved.subgroup_id, "SG1");
	assert.equal(saved.brand_id, null);
});

test("saveAccountLink clears prior brand state when the verified key resolves to a different account", async () => {
	const service = buildService([{ id: "acclink_1", group_id: "G_OLD", brand_id: "brand_1", brand_status: "VERIFIED" }]);
	const saved = await service.saveAccountLink({
		apiKeyCiphertext: "ct2", apiKeyLast4: "5678", groupId: "G_NEW", subgroupId: "SG_NEW",
	});
	assert.equal(saved.group_id, "G_NEW");
	assert.equal(saved.brand_id, null);
	assert.equal(saved.brand_status, null);
});

test("saveAccountLink carries brand state forward on a same-account key rotation (Change key)", async () => {
	const service = buildService([{
		id: "acclink_1", group_id: "G1", brand_id: "brand_1", brand_carrier_id: "B123",
		brand_status: "VERIFIED", brand_synced_at: "2026-01-01T00:00:00.000Z",
	}]);
	const saved = await service.saveAccountLink({
		apiKeyCiphertext: "ct2", apiKeyLast4: "9999", groupId: "G1", subgroupId: "SG1",
	});
	assert.equal(saved.group_id, "G1");
	assert.equal(saved.brand_id, "brand_1");
	assert.equal(saved.brand_carrier_id, "B123");
	assert.equal(saved.brand_status, "VERIFIED");
	assert.equal(saved.brand_synced_at, "2026-01-01T00:00:00.000Z");
});

test("saveBrandStatus throws when no account is linked yet", async () => {
	const service = buildService([]);
	await assert.rejects(
		() => service.saveBrandStatus({ brandId: "brand_1", brandCarrierId: null, brandStatus: "PENDING_CREATION" }),
		/before an account is linked/,
	);
});

test("saveBrandStatus updates the existing row's brand fields", async () => {
	const service = buildService([{ id: "acclink_1", group_id: "G1" }]);
	const saved = await service.saveBrandStatus({ brandId: "brand_1", brandCarrierId: "B123", brandStatus: "VERIFIED" });
	assert.equal(saved.brand_id, "brand_1");
	assert.equal(saved.brand_carrier_id, "B123");
	assert.equal(saved.brand_status, "VERIFIED");
});

test("saveAccountLink preserves sms_cost_per_segment_cents across a same-account key rotation", async () => {
	const service = buildService([{ id: "acclink_1", group_id: "G1", sms_cost_per_segment_cents: 5 }]);
	const saved = await service.saveAccountLink({
		apiKeyCiphertext: "ct2", apiKeyLast4: "9999", groupId: "G1", subgroupId: "SG1",
	});
	assert.equal(saved.sms_cost_per_segment_cents, 5);
});

test("saveAccountLink preserves sms_cost_per_segment_cents even when the linked account changes", async () => {
	const service = buildService([{ id: "acclink_1", group_id: "G_OLD", sms_cost_per_segment_cents: 5 }]);
	const saved = await service.saveAccountLink({
		apiKeyCiphertext: "ct2", apiKeyLast4: "9999", groupId: "G_NEW", subgroupId: "SG_NEW",
	});
	assert.equal(saved.sms_cost_per_segment_cents, 5);
	assert.equal(saved.brand_id, null);
});

test("setSmsCostPerSegmentCents throws when no account is linked yet", async () => {
	const service = buildService([]);
	await assert.rejects(() => service.setSmsCostPerSegmentCents(5), /before an account is linked/);
});

test("setSmsCostPerSegmentCents updates the existing row", async () => {
	const service = buildService([{ id: "acclink_1", group_id: "G1", sms_cost_per_segment_cents: null }]);
	const saved = await service.setSmsCostPerSegmentCents(8);
	assert.equal(saved.sms_cost_per_segment_cents, 8);
});

test("setSmsCostPerSegmentCents(null) clears a previously-set value", async () => {
	const service = buildService([{ id: "acclink_1", group_id: "G1", sms_cost_per_segment_cents: 8 }]);
	const saved = await service.setSmsCostPerSegmentCents(null);
	assert.equal(saved.sms_cost_per_segment_cents, null);
});

function buildJobStateService(rows: any[]) {
	const service = Object.create(SettingsModuleService.prototype) as any;
	const created: any[] = [];
	const updated: any[] = [];

	service.listJobStates = async (filter: any) => [...rows, ...created].filter((row) => row.name === filter.name);
	service.createJobStates = async (data: any) => {
		const record = { id: `jobstate_${created.length}`, ...data };
		created.push(record);
		return record;
	};
	service.updateJobStates = async (updates: any[]) => {
		updated.push(...updates);
		return updates;
	};

	return { service: service as SettingsModuleService, created, updated };
}

test("recordJobTick creates the job's row and starts a period on its first run", async () => {
	const { service, created, updated } = buildJobStateService([]);
	const now = new Date("2026-09-16T20:00:00.000Z");
	const result = await service.recordJobTick("cart-abandonment", now);
	assert.equal(result.restarted, true);
	assert.equal(result.activeSince.getTime(), now.getTime());
	assert.equal(created.length, 1);
	assert.equal(created[0].name, "cart-abandonment");
	assert.equal(created[0].last_tick_at.getTime(), now.getTime());
	assert.equal(updated.length, 0);
});

test("recordJobTick keeps the stored start and only moves last_tick_at on a regular run", async () => {
	const activeSince = new Date("2026-09-10T12:00:00.000Z");
	const now = new Date("2026-09-16T20:00:00.000Z");
	const { service, created, updated } = buildJobStateService([
		{ id: "jobstate_1", name: "cart-abandonment", active_since: activeSince, last_tick_at: new Date(now.getTime() - 15 * 60 * 1000) },
	]);
	const result = await service.recordJobTick("cart-abandonment", now);
	assert.equal(result.restarted, false);
	assert.equal(result.activeSince.getTime(), activeSince.getTime());
	assert.equal(created.length, 0);
	assert.deepEqual(updated, [{ id: "jobstate_1", active_since: activeSince, last_tick_at: now }]);
});

test("recordJobTick restarts the period after the job has been silent past the resume gap", async () => {
	const now = new Date("2026-09-16T20:00:00.000Z");
	const { service, updated } = buildJobStateService([
		{ id: "jobstate_1", name: "cart-abandonment", active_since: new Date("2026-09-01T00:00:00.000Z"), last_tick_at: new Date("2026-09-15T08:00:00.000Z") },
	]);
	const result = await service.recordJobTick("cart-abandonment", now);
	assert.equal(result.restarted, true);
	assert.equal(result.activeSince.getTime(), now.getTime());
	assert.equal(updated[0].active_since.getTime(), now.getTime());
});
