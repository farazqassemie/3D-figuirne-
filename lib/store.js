import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = path.resolve('data');
const JOBS_DIR = path.join(DATA_DIR, 'jobs');
fs.mkdirSync(JOBS_DIR, { recursive: true });

function jobPath(id) {
  return path.join(JOBS_DIR, `${id}.json`);
}

export function createJob(flow) {
  const id = crypto.randomBytes(6).toString('hex');
  const job = {
    id,
    // Unguessable capability token — required to read this job or its files, so
    // one customer can never see another's photos/model just by knowing an id.
    token: crypto.randomBytes(16).toString('hex'),
    flow,
    status: 'created',
    createdAt: new Date().toISOString(),
    providers: {},
    files: {},
    timings: [],
    log: [],
    error: null,
  };
  saveJob(job);
  fs.mkdirSync(path.join(DATA_DIR, 'uploads', id), { recursive: true });
  return job;
}

export function getJob(id) {
  if (!/^[a-f0-9]{12}$/.test(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(jobPath(id), 'utf8'));
  } catch {
    return null;
  }
}

export function saveJob(job) {
  const target = jobPath(job.id);
  fs.writeFileSync(target + '.tmp', JSON.stringify(job, null, 2));
  fs.renameSync(target + '.tmp', target);
}

export function listJobs() {
  return fs
    .readdirSync(JOBS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(JOBS_DIR, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function jobDir(id) {
  return path.join(DATA_DIR, 'uploads', id);
}

export function update(id, patch) {
  const job = getJob(id);
  if (!job) return null;
  Object.assign(job, patch);
  saveJob(job);
  return job;
}

export function logEvent(id, message) {
  const job = getJob(id);
  if (!job) return;
  job.log.push({ at: new Date().toISOString(), message });
  saveJob(job);
}

export async function timed(id, stage, provider, fn) {
  const startedAt = Date.now();
  logEvent(id, `${stage} started (${provider})`);
  try {
    const result = await fn();
    const ms = Date.now() - startedAt;
    const job = getJob(id);
    job.timings.push({ stage, provider, ms, ok: true });
    saveJob(job);
    logEvent(id, `${stage} finished in ${(ms / 1000).toFixed(1)}s`);
    return result;
  } catch (err) {
    const ms = Date.now() - startedAt;
    const job = getJob(id);
    job.timings.push({ stage, provider, ms, ok: false });
    saveJob(job);
    logEvent(id, `${stage} FAILED after ${(ms / 1000).toFixed(1)}s: ${err.message}`);
    throw err;
  }
}
