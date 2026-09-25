import pool from '../config/db.js';
import { parseCounts, deriveStatus, recordRun, raiseExceptionForAllSchools, autoResolve } from '../services/opsService.js';

import attendanceWorker from './attendanceWorker.js';
import guidanceWorker from './dailyGuidanceWorker.js';
import teacherAttendanceWorker from './teacherAttendanceAggregationWorker.js';
import gpsPollWorker from './gpsPollWorker.js';
import libraryWorker from './libraryDueDateWorker.js';
import feeReminderWorker from './feeReminderWorker.js';
import pettyCashReminderWorker from './pettyCashReminderWorker.js';
import staffLeaveReminderWorker from './staffLeaveReminderWorker.js';
import teachingReminderWorker from './teachingReminderWorker.js';
import lowAttendanceAlertWorker from './lowAttendanceAlertWorker.js';
import eventReminderWorker from './eventReminderWorker.js';
import performanceDriftWorker from './performanceDriftWorker.js';
import weeklyProgressSummaryWorker from './weeklyProgressSummaryWorker.js';
import recurringDoubtWorker from './recurringDoubtWorker.js';

// ------------------------------------------------------------------
// Every existing worker already `export default`s its Worker instance, so
// instead of editing 14 worker files this hooks each one's completed /
// failed events once, here. New workers only need a line in WORKERS and a
// row in automation_registry.
//
// These workers are platform-wide (one job loops over all schools), so
// their runs are recorded with school_id = NULL, and a failure of a
// critical one is raised into every active school's inbox.
// ------------------------------------------------------------------

const WORKERS = [
  // keyFor(job) lets one queue carry more than one automation.
  { worker: attendanceWorker, keyFor: (job) => (job.name === 'escalateToVoiceCall' ? 'attendance_escalation' : 'attendance_alert') },
  { worker: guidanceWorker, keyFor: () => 'daily_guidance' },
  { worker: teacherAttendanceWorker, keyFor: () => 'teacher_attendance_rollup' },
  { worker: gpsPollWorker, keyFor: () => 'gps_poll' },
  { worker: libraryWorker, keyFor: () => 'library_digest' },
  { worker: feeReminderWorker, keyFor: () => 'fee_reminder' },
  { worker: pettyCashReminderWorker, keyFor: () => 'petty_cash_reminder' },
  { worker: staffLeaveReminderWorker, keyFor: () => 'staff_leave_reminder' },
  { worker: teachingReminderWorker, keyFor: () => 'teaching_reminder' },
  { worker: lowAttendanceAlertWorker, keyFor: () => 'low_attendance_alert' },
  { worker: eventReminderWorker, keyFor: () => 'event_reminder' },
  { worker: performanceDriftWorker, keyFor: () => 'performance_drift' },
  { worker: weeklyProgressSummaryWorker, keyFor: () => 'weekly_progress_summary' },
  { worker: recurringDoubtWorker, keyFor: () => 'recurring_doubt' },
];

let registryCache = { at: 0, rows: new Map() };
async function registryRow(key) {
  if (Date.now() - registryCache.at > 5 * 60 * 1000) {
    try {
      const r = await pool.query('SELECT automation_key, display_name, critical FROM automation_registry');
      registryCache = { at: Date.now(), rows: new Map(r.rows.map((row) => [row.automation_key, row])) };
    } catch (err) {
      console.error('[ops] registry load failed:', err.message);
    }
  }
  return registryCache.rows.get(key);
}

async function onFinished(key, job, { counts, error }) {
  const status = error ? 'failed' : deriveStatus(counts);
  await recordRun({
    key,
    status,
    startedAt: job?.processedOn ? new Date(job.processedOn) : new Date(),
    itemsTotal: counts.total,
    itemsSucceeded: counts.succeeded,
    itemsFailed: counts.failed,
    errorSummary: error ? error.message : null,
    meta: { job_id: job?.id, job_name: job?.name },
  });

  const reg = await registryRow(key);
  const name = reg?.display_name || key;

  if (status === 'success') {
    await autoResolve(`automation:${key}`);
    await autoResolve(`stale:${key}`);
    return;
  }

  // A crashed job is always worth a look. A partial run only for critical
  // automations — a few failed library digests aren't worth the operator's
  // attention, a few failed fee reminders are.
  if (status === 'failed' || reg?.critical) {
    await raiseExceptionForAllSchools({
      source: 'automation_failure',
      severity: status === 'failed' ? (reg?.critical ? 'critical' : 'high') : 'medium',
      title: status === 'failed' ? `${name} failed` : `${name}: ${counts.failed} of ${counts.total} failed`,
      body: error
        ? `Error: ${error.message}`
        : `Last run finished with ${counts.succeeded} succeeded and ${counts.failed} failed. Check the automation's run history for details.`,
      entityType: 'automation',
      suggestedAction: { label: 'Run again now', action: 'automation.run_now', params: { automation_key: key } },
      dedupeKey: `automation:${key}`,
    });
  }
}

export function instrumentWorkers() {
  for (const { worker, keyFor } of WORKERS) {
    if (!worker || typeof worker.on !== 'function') continue;
    worker.on('completed', (job, returnValue) => {
      onFinished(keyFor(job), job, { counts: parseCounts(returnValue) }).catch((err) =>
        console.error('[ops] instrumentation completed-handler error:', err.message)
      );
    });
    worker.on('failed', (job, err) => {
      onFinished(keyFor(job || {}), job, { counts: parseCounts(null), error: err }).catch((e) =>
        console.error('[ops] instrumentation failed-handler error:', e.message)
      );
    });
  }
  console.log(`[ops] Instrumented ${WORKERS.length} workers for the Control Center.`);
}
