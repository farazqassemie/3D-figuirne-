import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { createJob, getJob, listJobs, jobDir, update } from './lib/store.js';
import { startFlow3, approveJob, runPreview } from './lib/pipeline.js';
import { previewProviderName, availablePreviewEngines, hi3dBalance, isLocked } from './lib/providers/preview.js';

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Admin surfaces (job list, vendor balance) expose every job + the Hi3D balance,
// so they are gated behind a shared secret. Set ADMIN_TOKEN in .env, then open
// /admin.html?token=YOUR_TOKEN. Customer endpoints stay open.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
function requireAdmin(req, res, next) {
  const t = req.get('x-admin-token') || req.query.token;
  if (ADMIN_TOKEN && t === ADMIN_TOKEN) return next();
  return res.status(401).json({ error: 'Admin auth required — set ADMIN_TOKEN in .env and pass ?token=.' });
}

// A caller "owns" a job if it presents that job's capability token (?t=), or the
// admin token as a master key. This is what stops one customer from seeing
// another's photos/model just by knowing (or guessing) a job id.
function ownsJob(req, job) {
  const t = req.query.t || req.get('x-job-token');
  if (job.token && t === job.token) return true;
  return !!ADMIN_TOKEN && (req.get('x-admin-token') || req.query.token) === ADMIN_TOKEN;
}

// Serve ONLY a job's own uploads/mesh under /files, and ONLY to someone holding
// that job's token (or admin). Never job records, other jobs' files, dotfiles,
// path-traversal, or active content.
app.use(
  '/files',
  (req, res, next) => {
    const p = decodeURIComponent(req.path);
    const m = p.match(/^\/uploads\/([a-f0-9]{12})\/[^/]+$/);
    if (!m || p.includes('..')) return res.status(403).end();
    const job = getJob(m[1]);
    if (!job || !ownsJob(req, job)) return res.status(403).end();
    next();
  },
  express.static('data', { setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') })
);

// Only real images, and the stored extension is derived from the detected MIME
// (NEVER the attacker-controlled filename) so a .html/.svg can't be stored and
// later served as active content. HEIC is rejected here (sharp can't decode it)
// instead of failing later on a paid generation.
const ALLOWED_IMAGE = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, jobDir(req.jobId)),
    filename: (req, file, cb) => {
      const ext = ALLOWED_IMAGE[file.mimetype] || '.jpg';
      cb(null, `${file.fieldname}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 60 * 1024 * 1024 }, // 60MB/photo is ample for phone shots
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE[file.mimetype]) return cb(null, true);
    const e = new Error('Only JPEG, PNG, or WebP photos are allowed.');
    e.status = 400;
    cb(e);
  },
});

// ?preview= lets internal tests pin a preview engine per job, so engines can be
// A/B-measured on identical inputs instead of trusted on reputation.
const PREVIEW_PROVIDERS = ['mock', 'fal-rodin', 'hi3d'];

function withNewJob(flow) {
  return (req, res, next) => {
    const job = createJob(flow);
    if (PREVIEW_PROVIDERS.includes(req.query.preview)) {
      update(job.id, { providerOverrides: { preview: req.query.preview } });
    }
    req.jobId = job.id;
    next();
  };
}

// Turn the customer's engine pick (chosen on the home page, sent as multipart
// text fields) into validated job fields. Unknown/absent choices leave the job
// on the default provider. A subject only sticks for engines that offer one
// (Hi3D: figurine|portrait).
function engineChoiceFrom(body) {
  const engines = availablePreviewEngines();
  const chosen = engines.find((e) => e.id === body?.engine);
  if (!chosen || chosen.id === 'mock') return {};
  const out = { engine: chosen.id };
  if (chosen.subjects) {
    const ids = chosen.subjects.map((s) => s.id);
    out.subject = ids.includes(body?.subject) ? body.subject : chosen.subjects[0].id;
  }
  // Model 2 (Hi3D) multi-view: 4-bit mask of which of front/back/left/right
  // the customer supplied (e.g. "1011"). Must match the photo order/count.
  if (chosen.id === 'model2' && /^[01]{4}$/.test(body?.multiViewBit || '')) {
    out.multiViewBit = body.multiViewBit;
  }
  return out;
}

app.post('/api/flow3', withNewJob(3), upload.array('photos', 8), (req, res) => {
  // A recognized engine the customer explicitly picked but that isn't available
  // must be REJECTED, never silently downgraded to a lower-quality default.
  const KNOWN_ENGINES = ['model1', 'model2'];
  if (KNOWN_ENGINES.includes(req.body?.engine) && !availablePreviewEngines().some((e) => e.id === req.body.engine)) {
    return res.status(409).json({ error: 'That engine is not available right now.' });
  }
  const choice = engineChoiceFrom(req.body);
  // Locked options are visible but can't be started. A request with no engine
  // would run on the default provider (Model 1), so that's checked too.
  if (isLocked(choice.engine || 'model1', choice.subject)) {
    return res.status(409).json({ error: 'That option is locked right now. Please choose another one.' });
  }
  // Portrait (Hi3D) uses a single front photo → min 1. Figurine (Hi3D) sends its
  // canonical front/back/left/right views → min 2. Model 1 uses the full spread → min 4.
  const min = choice.engine === 'model2' ? (choice.subject === 'portrait' ? 1 : 2) : 4;
  if (!req.files || req.files.length < min) {
    return res.status(400).json({ error: `At least ${min} photos required` });
  }
  update(req.jobId, { status: 'uploaded', ...choice });
  startFlow3(req.jobId, req.files.map((f) => f.path)).catch(() => {});
  // The token is the customer's capability to view THIS job — hand it back once.
  res.json({ jobId: req.jobId, token: getJob(req.jobId).token });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.token && !ownsJob(req, job)) return res.status(403).json({ error: 'Forbidden' });
  const { token, ...safe } = job; // never echo the token back in the body
  res.json(safe);
});

app.post('/api/jobs/:id/approve', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.token && !ownsJob(req, job)) return res.status(403).json({ error: 'Forbidden' });
  if (job.status !== 'preview_ready') return res.status(409).json({ error: `Cannot approve in status ${job.status}` });
  approveJob(job.id).catch(() => {});
  res.json({ ok: true });
});

app.post('/api/jobs/:id/regenerate', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.token && !ownsJob(req, job)) return res.status(403).json({ error: 'Forbidden' });
  if (!['preview_ready', 'preview_failed'].includes(job.status)) {
    return res.status(409).json({ error: `Cannot regenerate in status ${job.status}` });
  }
  // A brand-new paid run on a locked option is blocked. Retrying a FAILED job is
  // still allowed: it resumes the already-paid task instead of paying again.
  if (job.status === 'preview_ready' && isLocked(job.engine || 'model1', job.subject)) {
    return res.status(409).json({ error: 'That option is locked right now, so it can’t be regenerated.' });
  }
  const sources = (job.files.photos || []).slice(0, 5).map((p) => path.join('data', p.replace('/files/', '')));
  if (!sources.length) {
    // e.g. a job that failed at photo normalization keeps no usable photos.
    return res.status(409).json({ error: 'No usable photos on this job — please start over and upload new ones.' });
  }
  // A retry after a failure may reuse the already-paid mesh; a regenerate from
  // preview_ready means the customer wants a different result.
  runPreview(job.id, sources, { reuseMesh: job.status === 'preview_failed' }).catch(() => {});
  res.json({ ok: true });
});

app.get('/api/jobs', requireAdmin, (req, res) => {
  res.json(listJobs().map(({ token, ...j }) => j)); // don't expose per-job tokens in the admin list
});

app.get('/api/config', (req, res) => {
  res.json({ preview: previewProviderName() });
});

// The engines a customer may pick right now (drives the home-page boxes).
app.get('/api/engines', (req, res) => {
  res.json({ engines: availablePreviewEngines(), default: previewProviderName() });
});

// Best-effort Hi3D account balance for the admin dashboard. Never fails the
// request — a missing key or provider error just returns { error }.
app.get('/api/hi3d/balance', requireAdmin, async (req, res) => {
  try {
    res.json({ balance: await hi3dBalance() });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.use((err, req, res, next) => {
  let status = 500;
  let message = `Server error: ${err.message}`;
  if (err instanceof multer.MulterError) {
    // Every MulterError is a bad client upload — 4xx, not 500.
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'A photo is too large (max 60MB each).'
        : err.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Too many photos — send at most 8.'
          : `Upload rejected: ${err.message}`;
  } else if (err.status) {
    status = err.status; // e.g. the fileFilter's 400 for non-image uploads
    message = err.message;
  }
  if (req.jobId) {
    const job = getJob(req.jobId);
    // Only brand-new jobs become 'failed'. A job that already has paid work
    // (a preview, a placed order) keeps its status — the upload just failed.
    if (job && ['created', 'uploaded'].includes(job.status)) {
      update(req.jobId, { status: 'failed', error: message });
    } else if (job) {
      update(req.jobId, { error: message });
    }
  }
  res.status(status).json({ error: message });
});

// At boot nothing can be in flight — anything mid-run was killed by the
// restart. Move those jobs to retryable states.
function sweepInterrupted() {
  for (const job of listJobs()) {
    if (job.status === 'preview_running') {
      update(job.id, { status: 'preview_failed', error: 'Interrupted by a server restart — try again.' });
    } else if (['created', 'uploaded'].includes(job.status)) {
      update(job.id, { status: 'failed', error: 'Interrupted by a server restart — please start over.' });
    }
  }
}
sweepInterrupted();

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Figurine MVP running at http://localhost:${port}`);
  console.log(`Preview engine (default): ${previewProviderName()}`);
});
