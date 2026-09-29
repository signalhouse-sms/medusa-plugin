/**
 * How long a scheduled job can go without running before its next run counts as a fresh start.
 *
 * The enable switches are env vars, so a job can't observe being turned off. A long silence is the
 * only signal it gets: a job that was disabled (or whose host was down) for longer than this starts
 * over instead of catching up on everything that went stale in the meantime. Short gaps such as a
 * deploy or restart are well under this and resume normally.
 */
export const JOB_RESUME_GAP_MS = 2 * 60 * 60 * 1000;

export type JobStateRow = {
	active_since: Date | string;
	last_tick_at: Date | string;
};

/**
 * Resolves when a scheduled job's current active period started, so it only acts on records that
 * changed after it was switched on rather than on an existing backlog.
 *
 * A missing row, an unreadable timestamp, or a last run older than `resumeGapMs` all restart the
 * period at `now`. Otherwise the stored start carries over.
 *
 * @param {JobStateRow | null} state - The job's stored state, or null if it has never run.
 * @param {Date} now - The current run's time.
 * @param {number} [resumeGapMs] - Longest gap between runs that still continues the same period.
 * @returns {{ activeSince: Date, restarted: boolean }} The period start and whether this run began it.
 */
export function resolveJobActiveSince(
	state: JobStateRow | null,
	now: Date,
	resumeGapMs: number = JOB_RESUME_GAP_MS,
): { activeSince: Date; restarted: boolean } {
	if (!state) {
		return { activeSince: now, restarted: true };
	}

	const lastTick = new Date(state.last_tick_at).getTime();
	const activeSince = new Date(state.active_since);
	if (
		Number.isNaN(lastTick) ||
		Number.isNaN(activeSince.getTime()) ||
		now.getTime() - lastTick > resumeGapMs ||
		activeSince.getTime() > now.getTime()
	) {
		return { activeSince: now, restarted: true };
	}

	return { activeSince, restarted: false };
}

/**
 * Picks the earliest `updated_at` a record may have and still be acted on: the later of the job's
 * fixed lookback start and when its current active period began, moved back by the time a record
 * takes to qualify. A cart counts as abandoned `thresholdMs` after its last update, so one touched
 * shortly before the job started only becomes abandoned inside the active period and must stay
 * eligible; one that was already abandoned when the job started must not.
 *
 * @param {Date} activeSince - When the job's current active period began.
 * @param {Date} lookbackStart - The oldest a record may be regardless of when the job started.
 * @param {number} [thresholdMs] - How long after its last update a record qualifies.
 * @returns {Date} The later of the lookback start and `activeSince - thresholdMs`.
 */
export function resolveJobWindowStart(activeSince: Date, lookbackStart: Date, thresholdMs: number = 0): Date {
	const periodStart = activeSince.getTime() - thresholdMs;
	return periodStart > lookbackStart.getTime() ? new Date(periodStart) : lookbackStart;
}
