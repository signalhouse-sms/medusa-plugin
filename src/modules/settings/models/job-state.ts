import { model } from "@medusajs/framework/utils";

/**
 * Per-job bookkeeping for scheduled jobs that must not act on a backlog when first switched on.
 *
 * `active_since` is when the job's current active period began; `last_tick_at` is its most recent
 * run. One row per job `name`. See `utils/jobActiveWindow.ts` for how a long gap between runs
 * restarts the period.
 */
const JobState = model.define("signalhouse_job_state", {
	id: model.id().primaryKey(),
	name: model.text().unique(),
	active_since: model.dateTime(),
	last_tick_at: model.dateTime(),
});

export default JobState;
