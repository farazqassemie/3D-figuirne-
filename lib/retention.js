import fs from 'fs';
import path from 'path';
import { listJobs, getJob, update, jobDir } from './store.js';

// Customer photos can contain face geometry, which several US states (Illinois
// BIPA, Texas, Washington, and others) treat as biometric data. The privacy
// policy promises a public retention schedule, so this module is what makes
// that promise true:
//   - photos are deleted PHOTO_RETENTION_DAYS after the job (or the order) date
//   - the generated 3D model is deleted MODEL_RETENTION_DAYS after that date
//   - a customer can delete everything at any time (deleteJobData)
// The numbers shown on /privacy.html come from the same settings via /api/legal.
export function retentionDays() {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    photos: num(process.env.PHOTO_RETENTION_DAYS, 30),
    models: num(process.env.MODEL_RETENTION_DAYS, 365),
  };
}

const DAY = 24 * 60 * 60 * 1000;

// Remove everything this job stored on disk and keep only a bare record (no
// photos, no model, no vendor links) so the admin page still shows the job ran.
export function deleteJobData(id, reason) {
  const job = getJob(id);
  if (!job) return null;
  fs.rmSync(jobDir(id), { recursive: true, force: true });
  fs.mkdirSync(jobDir(id), { recursive: true });
  return update(id, {
    status: 'deleted',
    files: {},
    falMeshUrl: null,
    hi3dTaskId: null,
    error: null,
    deletedAt: new Date().toISOString(),
    deletedReason: reason,
  });
}

// Delete photos (keeping the model) once they pass the photo retention period.
function deletePhotos(job) {
  const keep = job.files?.preview ? path.basename(job.files.preview) : null;
  const dir = jobDir(job.id);
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (f !== keep) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  }
  update(job.id, { files: { ...job.files, photos: [] }, photosDeletedAt: new Date().toISOString() });
}

export function sweepRetention(now = Date.now()) {
  const { photos, models } = retentionDays();
  for (const job of listJobs()) {
    // Photos uploaded but never paid for are deleted after 1 day.
    if (job.status === 'draft') {
      if (now - Date.parse(job.createdAt) > DAY) deleteJobData(job.id, 'unpaid draft older than 1 day');
      continue;
    }
    // Never pull files out from under a generation that is still running.
    if (['created', 'uploaded', 'preview_running', 'deleted'].includes(job.status)) continue;
    const since = Date.parse(job.approvedAt || job.createdAt);
    if (!Number.isFinite(since)) continue;
    const age = now - since;
    if (age > models * DAY) {
      deleteJobData(job.id, `retention: older than ${models} days`);
    } else if (age > photos * DAY && !job.photosDeletedAt) {
      deletePhotos(job);
    }
  }
}

export function startRetentionSweeper() {
  const run = () => {
    try {
      sweepRetention();
    } catch (err) {
      console.error('retention sweep failed:', err.message);
    }
  };
  run();
  setInterval(run, 60 * 60 * 1000).unref(); // hourly
}
