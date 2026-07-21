import fs from 'fs';
import path from 'path';
import { fal } from '@fal-ai/client';

export function previewProviderName() {
  if (process.env.PREVIEW_PROVIDER) return process.env.PREVIEW_PROVIDER;
  return process.env.FAL_KEY ? 'fal-rodin' : 'mock';
}

// Customer-facing engine id -> internal provider id. Customers only ever see
// 'model1' / 'model2' (the vendor names stay on this side of the boundary); the
// ?preview= query override (internal A/B tests) still uses the raw provider ids
// and always wins over the customer choice.
export const PREVIEW_ENGINE_PROVIDER = { model1: 'fal-rodin', model2: 'hi3d' };

export function resolvePreviewProvider(job) {
  if (job?.providerOverrides?.preview) return job.providerOverrides.preview; // internal test pin
  if (job?.engine && PREVIEW_ENGINE_PROVIDER[job.engine]) return PREVIEW_ENGINE_PROVIDER[job.engine];
  return previewProviderName();
}

// Returns the path of a GLB written into destDir.
// opts.provider: 'mock' | 'fal-rodin' | 'hi3d'
// opts.subject:  'figurine' | 'portrait'  (Hi3D only — selects the model)
// opts.priorMeshUrl: mesh URL from an earlier paid generation whose download
//   failed — tried first so the retry costs nothing.
// opts.priorTaskId:  Hi3D task id from an interrupted run — re-queried/resumed
//   so an interrupted poll never re-pays for a new generation.
// opts.onMeshUrl:  called with the mesh URL as soon as the generation is paid for.
// opts.onTaskId:   called with the Hi3D task id as soon as it exists (Hi3D only).
// opts.onLog:      called with human-readable progress lines (recorded per job).
export async function generatePreview(imagePaths, destDir, opts = {}) {
  const provider = opts.provider || previewProviderName();
  if (provider === 'mock') return mockPreview(destDir);
  if (provider === 'fal-rodin') return falRodin(imagePaths, destDir, opts);
  if (provider === 'hi3d') return hi3dGenerate(imagePaths, destDir, opts);
  throw new Error(`Unknown preview provider: ${provider}`);
}

// Which preview engines a customer may choose right now. Hi3D only appears once
// both halves of its credential (client_id + client_secret) are set — so the UI
// never offers an engine that would fail. Set HI3D_ENABLED=0 to force-hide it
// even with credentials (e.g. before a first real verification run).
export function availablePreviewEngines() {
  const engines = [];
  if (process.env.FAL_KEY || process.env.PREVIEW_PROVIDER === 'fal-rodin') {
    engines.push({ id: 'model1', label: 'Model 1', blurb: 'Fast · best full-body figurine' });
  }
  if (hi3dConfigured()) {
    engines.push({
      id: 'model2',
      label: 'Model 2',
      blurb: 'Highest detail · best face likeness',
      subjects: [
        { id: 'figurine', label: 'Full figurine' },
        { id: 'portrait', label: 'Portrait (head & shoulders)' },
      ],
    });
  }
  if (!engines.length) engines.push({ id: 'mock', label: 'Mock (no keys set)' });
  return engines;
}

// ---------------------------------------------------------------------------
// Hi3D (hitem3d.ai) — Image / multi-view -> 3D, with a dedicated portrait model.
// Verified against docs.hi3d.ai (auth/token, submit-task, query-task, balance).
// Two-step auth: Basic client_id:client_secret -> a Bearer accessToken.
// Async: submit-task returns a task_id; poll query-task until state=success.
// ---------------------------------------------------------------------------
const HI3D_BASE = 'https://api.hitem3d.ai';
const HI3D_POLL_INTERVAL_MS = 8000;
// "The API call can take as long as it needs" — poll for a long time by default.
const HI3D_POLL_TIMEOUT_MS = Number(process.env.HI3D_MAX_WAIT_MS || 60 * 60 * 1000);

function hi3dConfigured() {
  return !!(process.env.HI3D_CLIENT_ID && process.env.HI3D_CLIENT_SECRET) && process.env.HI3D_ENABLED !== '0';
}

// hitem3dv2.1 (general figurine) vs scene-portraitv2.1 (portrait). Version is
// overridable but v2.1 is the newest / highest quality.
function hi3dModel(subject) {
  const version = process.env.HI3D_VERSION || 'v2.1';
  // Overridable so the general vs portrait model can be A/B-tested for max
  // photoreal detail without a code change (e.g. HI3D_PORTRAIT_MODEL=hitem3dv2.1
  // to try the general model on a person).
  if (subject === 'portrait') return process.env.HI3D_PORTRAIT_MODEL || `scene-portrait${version}`;
  return process.env.HI3D_FIGURINE_MODEL || `hitem3d${version}`;
}

async function hi3dParse(res, label) {
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Hi3D ${label} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok || (body.code && body.code !== 200)) {
    const msg = body.message || body.msg || JSON.stringify(body).slice(0, 300);
    throw new Error(`Hi3D ${label} error (HTTP ${res.status}, code ${body.code}): ${msg}`);
  }
  return body;
}

async function hi3dToken() {
  const id = process.env.HI3D_CLIENT_ID;
  const secret = process.env.HI3D_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('Hi3D needs HI3D_CLIENT_ID and HI3D_CLIENT_SECRET (from platform.hi3d.ai/console/apiKey).');
  }
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch(`${HI3D_BASE}/open-api/v1/auth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await hi3dParse(res, 'auth');
  const token = body?.data?.accessToken;
  if (!token) throw new Error(`Hi3D auth returned no accessToken: ${JSON.stringify(body).slice(0, 200)}`);
  return token;
}

// MAXIMUM-QUALITY profile, VERIFIED against docs.hi3d.ai (create-task, faq,
// pricing) as the absolute top tier — a 4-agent audit confirmed nothing higher
// exists (no resolution above 1536pro, no face count above 2M, no model newer
// than v2.1, no separate 4K-texture knob). These are BAKED IN, not env-tunable,
// so a fast/low-quality setting can never slip in. Critical: Hi3D's own
// defaults are NOT max (resolution defaults to 1024, face has no default), so
// every value is sent explicitly.
const HI3D_MAX = {
  resolution: '1536pro', // top tier — never 1536fast / 1536profast
  face: '2000000', // maximum polygon budget (100k–2M)
  request_type: '3', // geometry + texture in one pass (FAQ-recommended over staged)
  pbr: '1', // PBR materials on → 4K PBR textures
  format: '2', // glb — carries PBR maps (obj/stl would silently drop them)
};

async function hi3dSubmit(token, imagePaths, opts, onLog) {
  const subject = opts.subject === 'portrait' ? 'portrait' : 'figurine';
  const model = hi3dModel(subject);

  const form = new FormData();
  form.append('request_type', HI3D_MAX.request_type);
  form.append('model', model);
  form.append('resolution', HI3D_MAX.resolution);
  form.append('face', HI3D_MAX.face);
  form.append('format', HI3D_MAX.format);
  form.append('pbr', HI3D_MAX.pbr);

  // Multi-view materially improves the result (resolves occluded back/side
  // geometry) at the same price. Hi3D reads multi_images POSITIONALLY as
  // front,back,left,right, so multi_images_bit MUST mark which slots are present
  // (e.g. "1011" = front+left+right) — omitting it silently mislabels a partial
  // set. flow3 sends the canonical views in order plus the matching bit.
  const imgs = imagePaths.slice(0, 4);
  const ones = /^[01]{4}$/.test(opts.multiViewBit || '') ? (opts.multiViewBit.match(/1/g) || []).length : 0;
  // For a photoreal PORTRAIT face, a single sharp FRONT image beats multi-view:
  // Hi3D fuses views by cross-view AVERAGING, which smooths facial detail when
  // hand-held shots aren't perfectly consistent (per Hi3D's own research —
  // "inconsistent areas become overly smooth and blurry"). Extra views mainly
  // complete back/side STRUCTURE, not frontal skin, so portraits default to the
  // front image alone (imgs[0] = the Front view). Figurines keep multi-view
  // (they need 360° structure). Opt portraits back in with HI3D_PORTRAIT_MULTIVIEW=1.
  const portraitSingle = subject === 'portrait' && process.env.HI3D_PORTRAIT_MULTIVIEW !== '1';
  // Multi-view otherwise ONLY with a valid bit whose 1-count matches the image
  // count. Hi3D reads images POSITIONALLY (front/back/left/right); a wrong/absent
  // bit mislabels views. The customer path always supplies a valid matching bit.
  const useMulti = !portraitSingle && process.env.HI3D_MULTIVIEW !== '0' && imgs.length >= 2 && ones === imgs.length;
  if (useMulti) {
    for (const p of imgs) {
      form.append('multi_images', new File([fs.readFileSync(p)], path.basename(p), { type: 'image/jpeg' }));
    }
    form.append('multi_images_bit', opts.multiViewBit);
    onLog(
      `Hi3D: MAX quality — model=${model} resolution=${HI3D_MAX.resolution} face=${HI3D_MAX.face} ` +
        `request_type=${HI3D_MAX.request_type} pbr=${HI3D_MAX.pbr} format=glb | multi-view ${imgs.length} imgs, bit=${opts.multiViewBit}`
    );
  } else {
    const p = imgs[0] || imagePaths[0];
    form.append('images', new File([fs.readFileSync(p)], path.basename(p), { type: 'image/jpeg' }));
    onLog(
      `Hi3D: MAX quality — model=${model} resolution=${HI3D_MAX.resolution} face=${HI3D_MAX.face} ` +
        `request_type=${HI3D_MAX.request_type} pbr=${HI3D_MAX.pbr} format=glb | ` +
        `${portraitSingle ? 'single FRONT image (portrait high-fidelity path — no multi-view averaging)' : 'single image'}`
    );
  }

  const res = await fetch(`${HI3D_BASE}/open-api/v1/submit-task`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }, // let fetch set the multipart boundary
    body: form,
  });
  const body = await hi3dParse(res, 'submit-task');
  const taskId = body?.data?.task_id;
  if (!taskId) throw new Error(`Hi3D submit returned no task_id: ${JSON.stringify(body).slice(0, 300)}`);
  onLog(`Hi3D: task created, task_id=${taskId}`);
  return taskId;
}

// One-shot state probe (with retry) used to decide whether to resume an earlier
// task or start fresh — never resubmits on a flaky check (that would double-charge).
async function hi3dQueryState(token, taskId, onLog) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${HI3D_BASE}/open-api/v1/query-task?task_id=${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(await res.text());
      // A failed generation (code 50010001) resolves as 'failed' so the caller
      // starts a fresh attempt instead of aborting the retry.
      if (body.code === 50010001 || body?.data?.state === 'failed') return { state: 'failed' };
      if (!res.ok || (body.code && body.code !== 200)) {
        throw new Error(`code ${body.code} (HTTP ${res.status}): ${body.msg || body.message || 'error'}`);
      }
      return { state: body?.data?.state, url: body?.data?.url };
    } catch (err) {
      onLog(`Hi3D: earlier-task check error (${err.message}), attempt ${attempt}/3`);
      if (attempt === 3) {
        throw new Error(`Could not check the earlier Hi3D task — retry later instead of resubmitting: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// states per docs: created | queueing | processing | success | failed
async function hi3dPoll(token, taskId, onLog) {
  const deadline = Date.now() + HI3D_POLL_TIMEOUT_MS;
  let pollErrors = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, HI3D_POLL_INTERVAL_MS));
    let body;
    try {
      const res = await fetch(`${HI3D_BASE}/open-api/v1/query-task?task_id=${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      body = JSON.parse(await res.text());
    } catch (err) {
      // Network / non-JSON — genuinely transient, retry.
      pollErrors += 1;
      onLog(`Hi3D: status poll error (${err.message}), retry ${pollErrors}/5`);
      if (pollErrors >= 5) {
        throw new Error(`Hi3D status polling failed 5 times in a row (task ${taskId} may still finish — retry resumes it): ${err.message}`);
      }
      continue;
    }
    // TERMINAL: a real generation failure — Hi3D signals it via code 50010001
    // ("generate failed") or data.state==='failed'. Fail fast, don't retry it as
    // if it were transient, and don't claim "retry resumes it" (the task is dead).
    if (body.code === 50010001 || body?.data?.state === 'failed') {
      throw new Error(
        `Hi3D couldn't generate a model from these photos (${body.msg || body.message || 'generate failed'}). ` +
          `Try again with 4 clear, well-lit JPEG/PNG shots of the same subject — front, back, left, right.`
      );
    }
    // Any other non-200 application code — treat as transient and retry.
    if (body.code && body.code !== 200) {
      pollErrors += 1;
      onLog(`Hi3D: query-task code ${body.code} (${body.msg || body.message || ''}), retry ${pollErrors}/5`);
      if (pollErrors >= 5) throw new Error(`Hi3D status polling failed 5 times in a row (task ${taskId}): code ${body.code}`);
      continue;
    }
    pollErrors = 0;
    const state = body?.data?.state;
    onLog(`Hi3D: state=${state}`);
    if (state === 'success') {
      const url = body?.data?.url;
      if (!url) throw new Error(`Hi3D success but returned no model url: ${JSON.stringify(body).slice(0, 300)}`);
      return url;
    }
    // created | queueing | processing -> keep waiting
  }
  throw new Error(
    `Hi3D task timed out after ${Math.round(HI3D_POLL_TIMEOUT_MS / 60000)} min (task=${taskId}) — retry resumes it without a new charge.`
  );
}

async function hi3dGenerate(imagePaths, destDir, opts = {}) {
  const onLog = opts.onLog || (() => {});

  // 1) Cheapest retry: an already-generated mesh URL whose download failed last time.
  if (opts.priorMeshUrl) {
    try {
      onLog('Hi3D: re-using the already-generated model URL from the last attempt');
      return await downloadMesh(opts.priorMeshUrl, destDir);
    } catch {
      onLog('Hi3D: prior model URL expired/unreachable — checking the task instead');
    }
  }

  const token = await hi3dToken();

  // 2) Resume an earlier task (interrupted mid-poll) — no new charge.
  if (opts.priorTaskId) {
    const { state, url } = await hi3dQueryState(token, opts.priorTaskId, onLog);
    if (state === 'success' && url) {
      onLog(`Hi3D: earlier task ${opts.priorTaskId} already succeeded — downloading, no new charge`);
      if (opts.onMeshUrl) opts.onMeshUrl(url);
      return downloadMesh(url, destDir);
    }
    if (state === 'success') {
      // Success but no url — mirror hi3dPoll: retry later, never re-pay.
      throw new Error(`Hi3D earlier task ${opts.priorTaskId} reports success but returned no model url — retry later, no new charge.`);
    }
    if (['created', 'queueing', 'processing'].includes(state)) {
      onLog(`Hi3D: earlier task ${opts.priorTaskId} still ${state} — resuming, no new charge`);
      const finalUrl = await hi3dPoll(token, opts.priorTaskId, onLog);
      if (opts.onMeshUrl) opts.onMeshUrl(finalUrl);
      return downloadMesh(finalUrl, destDir);
    }
    // ONLY a genuinely failed task may start a fresh (paid) generation. Any other
    // / unknown state may still be live — resubmitting would double-charge.
    if (state !== 'failed') {
      throw new Error(`Hi3D earlier task ${opts.priorTaskId} in unresolved state "${state}" — retry resumes it without a new charge.`);
    }
    onLog(`Hi3D: earlier task failed — starting a new generation`);
  }

  // 3) Fresh generation.
  const taskId = await hi3dSubmit(token, imagePaths, opts, onLog);
  if (opts.onTaskId) opts.onTaskId(taskId);
  const url = await hi3dPoll(token, taskId, onLog);
  if (opts.onMeshUrl) opts.onMeshUrl(url);
  return downloadMesh(url, destDir);
}

// Account balance (Decimal) — used by the admin dashboard for cost tracking.
export async function hi3dBalance() {
  const token = await hi3dToken();
  const res = await fetch(`${HI3D_BASE}/open-api/v1/balance`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await hi3dParse(res, 'balance');
  return body?.data?.totalBalance;
}

async function falRodin(imagePaths, destDir, opts = {}) {
  fal.config({ credentials: process.env.FAL_KEY });

  if (opts.priorMeshUrl) {
    try {
      return await downloadMesh(opts.priorMeshUrl, destDir);
    } catch {
      // URL expired or unreachable — fall through to a fresh generation.
    }
  }

  let result;
  try {
    const urls = [];
    for (const p of imagePaths) {
      const file = new File([fs.readFileSync(p)], path.basename(p), { type: 'image/jpeg' });
      urls.push(await fal.storage.upload(file));
    }

    // Gen-2.5 (default) is the newer, higher-detail Rodin — the version the
    // Hyper3D web platform runs. Set RODIN_VERSION=v2 to fall back to Gen-2.
    const version = process.env.RODIN_VERSION || 'v2.5';
    const [endpoint, input] =
      version === 'v2'
        ? [
            'fal-ai/hyper3d/rodin',
            {
              input_image_urls: urls,
              condition_mode: 'concat',
              geometry_file_format: 'glb',
              material: 'PBR',
              quality: process.env.RODIN_QUALITY || 'high',
              use_hyper: process.env.RODIN_HYPER !== '0',
              tier: 'Regular',
              ...(process.env.RODIN_HIGHPACK === '1' ? { addons: 'HighPack' } : {}),
            },
          ]
        : [
            'fal-ai/hyper3d/rodin/v2.5',
            {
              image_urls: urls,
              // Maximum-quality defaults. Extreme-High = top tier (2M faces,
              // bills 2x); high_pack = 4K textures; is_micro = micro-scale
              // geometry (pores/fabric); texture_mode high + hd_texture = best
              // texture path. enable_creative_mode is deliberately OFF — it
              // adds generative liberty that hurts likeness. Dial cost down
              // with RODIN_TIER=Gen-2.5-High / RODIN_HIGHPACK=0 for fast previews.
              tier: process.env.RODIN_TIER || 'Gen-2.5-Extreme-High',
              geometry_file_format: 'glb',
              material: 'PBR',
              quality_mesh_option: process.env.RODIN_MESH || '2M Triangle',
              texture_mode: process.env.RODIN_TEXTURE || 'high',
              hd_texture: process.env.RODIN_HDTEX !== '0',
              is_micro: process.env.RODIN_MICRO !== '0',
              addons: { high_pack: process.env.RODIN_HIGHPACK !== '0' },
              ...(process.env.RODIN_DELIGHT === '1' ? { texture_delight: true } : {}),
              ...(process.env.RODIN_CREATIVE === '1' ? { enable_creative_mode: true } : {}),
            },
          ];

    // Wall-clock deadline so a fal job stuck IN_PROGRESS fails to preview_failed
    // (recoverable) instead of wedging the job in preview_running forever.
    result = await fal.subscribe(endpoint, { input, timeout: Number(process.env.FAL_MAX_WAIT_MS || 60 * 60 * 1000) });
  } catch (err) {
    const detail = err?.body?.detail;
    throw new Error(detail ? `fal.ai: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : `fal.ai: ${err.message}`);
  }

  const meshUrl = findGlbUrl(result.data);
  if (!meshUrl) {
    throw new Error(`Rodin returned no GLB. Response: ${JSON.stringify(result.data).slice(0, 500)}`);
  }
  if (opts.onMeshUrl) opts.onMeshUrl(meshUrl);

  return downloadMesh(meshUrl, destDir);
}

async function downloadMesh(url, destDir) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Downloading mesh failed: HTTP ${res.status}`);
  const dest = path.join(destDir, 'preview.glb');
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

function findGlbUrl(obj) {
  if (!obj) return null;
  if (typeof obj === 'string') return obj.includes('.glb') ? obj : null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findGlbUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof obj === 'object') {
    if (typeof obj.url === 'string' && obj.url.includes('.glb')) return obj.url;
    for (const value of Object.values(obj)) {
      const found = findGlbUrl(value);
      if (found) return found;
    }
  }
  return null;
}

async function mockPreview(destDir) {
  await new Promise((r) => setTimeout(r, 8000));
  const dest = path.join(destDir, 'preview.gltf');
  fs.copyFileSync(path.resolve('assets/mock.gltf'), dest);
  return dest;
}
