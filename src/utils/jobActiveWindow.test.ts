import { test } from "node:test";
import assert from "node:assert/strict";
import { JOB_RESUME_GAP_MS, resolveJobActiveSince, resolveJobWindowStart } from "./jobActiveWindow";

const now = new Date("2026-09-16T20:00:00.000Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000);

test("resolveJobActiveSince() starts a fresh period on the first run ever", () => {
	const result = resolveJobActiveSince(null, now);
	assert.equal(result.restarted, true);
	assert.equal(result.activeSince.getTime(), now.getTime());
});

test("resolveJobActiveSince() keeps the stored start while runs keep happening", () => {
	const activeSince = minutesAgo(3 * 24 * 60);
	const result = resolveJobActiveSince({ active_since: activeSince, last_tick_at: minutesAgo(15) }, now);
	assert.equal(result.restarted, false);
	assert.equal(result.activeSince.getTime(), activeSince.getTime());
});

test("resolveJobActiveSince() continues across a short gap such as a deploy", () => {
	const activeSince = minutesAgo(600);
	const result = resolveJobActiveSince({ active_since: activeSince, last_tick_at: minutesAgo(90) }, now);
	assert.equal(result.restarted, false);
	assert.equal(result.activeSince.getTime(), activeSince.getTime());
});

test("resolveJobActiveSince() restarts after a gap longer than the resume window (switched off, then on)", () => {
	const lastTick = new Date(now.getTime() - JOB_RESUME_GAP_MS - 60 * 1000);
	const result = resolveJobActiveSince({ active_since: minutesAgo(7 * 24 * 60), last_tick_at: lastTick }, now);
	assert.equal(result.restarted, true);
	assert.equal(result.activeSince.getTime(), now.getTime());
});

test("resolveJobActiveSince() accepts timestamps read back as strings", () => {
	const result = resolveJobActiveSince({ active_since: minutesAgo(60).toISOString(), last_tick_at: minutesAgo(15).toISOString() }, now);
	assert.equal(result.restarted, false);
	assert.equal(result.activeSince.getTime(), minutesAgo(60).getTime());
});

test("resolveJobActiveSince() restarts on unreadable or future timestamps rather than trusting them", () => {
	assert.equal(resolveJobActiveSince({ active_since: "garbage", last_tick_at: minutesAgo(15) }, now).restarted, true);
	assert.equal(resolveJobActiveSince({ active_since: minutesAgo(60), last_tick_at: "garbage" }, now).restarted, true);
	const future = resolveJobActiveSince({ active_since: new Date(now.getTime() + 60 * 1000), last_tick_at: minutesAgo(15) }, now);
	assert.equal(future.restarted, true);
	assert.equal(future.activeSince.getTime(), now.getTime());
});

test("resolveJobWindowStart() uses when the job started once that is inside the lookback", () => {
	const lookbackStart = minutesAgo(7 * 24 * 60);
	const activeSince = minutesAgo(90);
	assert.equal(resolveJobWindowStart(activeSince, lookbackStart).getTime(), activeSince.getTime());
});

test("resolveJobWindowStart() keeps carts touched just before switch-on, which only become abandoned after it", () => {
	const lookbackStart = minutesAgo(7 * 24 * 60);
	const activeSince = minutesAgo(10);
	const thresholdMs = 60 * 60 * 1000;
	const windowStart = resolveJobWindowStart(activeSince, lookbackStart, thresholdMs);
	assert.equal(windowStart.getTime(), minutesAgo(70).getTime());
	// Touched 30 min before switch-on: abandoned 30 min after it, so it must fall inside the window.
	const touchedJustBefore = minutesAgo(40);
	assert.ok(touchedJustBefore.getTime() > windowStart.getTime());
	// Touched 2h before switch-on: already abandoned when the job started, so it must fall outside.
	const alreadyAbandoned = minutesAgo(130);
	assert.ok(alreadyAbandoned.getTime() < windowStart.getTime());
});

test("resolveJobWindowStart() falls back to the lookback once the job has run longer than it", () => {
	const lookbackStart = minutesAgo(7 * 24 * 60);
	const activeSince = minutesAgo(30 * 24 * 60);
	assert.equal(resolveJobWindowStart(activeSince, lookbackStart).getTime(), lookbackStart.getTime());
});
