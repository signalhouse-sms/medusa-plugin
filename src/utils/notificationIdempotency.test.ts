import { test } from "node:test";
import assert from "node:assert/strict";
import { hasSucceededNotification } from "./notificationIdempotency";

/**
 * A stub Notification module whose `listNotifications` just returns whatever rows it's given,
 * capturing the filters it was called with for assertion.
 * @param {Array<{status: string}>} rows - The rows `listNotifications` should resolve to.
 * @returns {{service: object, calls: object[]}} The stub and its captured call filters.
 */
function stubNotificationModule(rows: Array<{ status: string }>) {
	const calls: unknown[] = [];
	return {
		service: {
			listNotifications: async (filters: unknown) => {
				calls.push(filters);
				return rows;
			},
		},
		calls,
	};
}

test("hasSucceededNotification returns true when a success row exists for this resource+template", async () => {
	const { service } = stubNotificationModule([{ status: "failure" }, { status: "success" }]);
	const result = await hasSucceededNotification(service as any, "order_1", "order", "order-placed");
	assert.equal(result, true);
});

test("hasSucceededNotification returns false when only failure rows exist", async () => {
	const { service } = stubNotificationModule([{ status: "failure" }, { status: "failure" }]);
	const result = await hasSucceededNotification(service as any, "order_1", "order", "order-placed");
	assert.equal(result, false);
});

test("hasSucceededNotification returns false when no rows exist yet", async () => {
	const { service } = stubNotificationModule([]);
	const result = await hasSucceededNotification(service as any, "order_1", "order", "order-placed");
	assert.equal(result, false);
});

test("hasSucceededNotification scopes the lookup by resource_id, resource_type, and template", async () => {
	const { service, calls } = stubNotificationModule([]);
	await hasSucceededNotification(service as any, "ful_1", "fulfillment", "shipment-created");
	assert.deepEqual(calls[0], { resource_id: "ful_1", resource_type: "fulfillment", template: "shipment-created" });
});
