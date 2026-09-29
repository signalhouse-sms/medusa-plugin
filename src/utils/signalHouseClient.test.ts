import { test } from "node:test";
import assert from "node:assert/strict";
import { unwrapSignalHouseResponse } from "./signalHouseClient";

test("unwrapSignalHouseResponse returns data on success", () => {
	const data = unwrapSignalHouseResponse({ success: true, data: { groupId: "G1" } }, "verify");
	assert.deepEqual(data, { groupId: "G1" });
});

test("unwrapSignalHouseResponse throws on success: false, including the SDK's own error detail", () => {
	assert.throws(
		() => unwrapSignalHouseResponse({ success: false, error: "invalid API key" }, "That key could not be verified"),
		/That key could not be verified.*invalid API key/,
	);
});

test("unwrapSignalHouseResponse throws when the response is undefined (network failure)", () => {
	assert.throws(() => unwrapSignalHouseResponse(undefined, "verify"), /verify/);
});
