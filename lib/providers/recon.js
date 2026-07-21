import fs from 'fs';
import path from 'path';

const KIRI_BASE = 'https://api.kiriengine.app/api/v1/open';
const POLL_INTERVAL_MS = 15000;
const POLL_TIMEOUT_MS = 45 * 60 * 1000;

export function reconProviderName() {
  if (process.env.RECON_PROVIDER) return process.env.RECON_PROVIDER;
  return process.env.KIRI_KEY ? 'kiri' : 'mock';
}

// Returns { file, kind } where file is a model archive or mesh written into destDir.
// opts.priorSerialize: token of an earlier scan — if that scan already
// succeeded, its model is downloaded without paying for a new scan.
// opts.onSerialize: called with the scan token as soon as it exists.
export async function generateRoughModel(imagePaths, destDir, onLog = () => {}, opts = {}) {
  const provider = opts.provider || reconProviderName();
  if (provider === 'mock') return mockRecon(destDir, onLog);
  if (provider === 'kiri') return kiri(imagePaths, destDir, onLog, opts);
  throw new Error(`Unknown recon provider: ${provider}`);
}

async function kiriFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.KIRI_KEY}`,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`KIRI returned non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok || (body.ok === false && body.code !== 0)) {
    throw new Error(`KIRI error (HTTP ${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

// Status codes per docs.kiriengine.app: -1 Uploading, 0 Processing,
// 1 Failed, 2 Successful, 3 Queuing, 4 Expired.
async function kiri(imagePaths, destDir, onLog, opts = {}) {
  if (opts.priorSerialize) {
    const prior = await checkPriorScan(opts.priorSerialize, onLog);
    if (prior === 'success') {
      onLog(`KIRI: earlier scan ${opts.priorSerialize} already succeeded — downloading it, no new charge`);
      return downloadKiriModel(opts.priorSerialize, destDir, onLog);
    }
    if (prior === 'running') {
      onLog(`KIRI: earlier scan ${opts.priorSerialize} is still processing — resuming it, no new charge`);
      await pollUntilDone(opts.priorSerialize, onLog);
      return downloadKiriModel(opts.priorSerialize, destDir, onLog);
    }
    onLog(`KIRI: earlier scan is ${prior} — starting a new scan`);
  }

  const form = new FormData();
  for (const p of imagePaths) {
    form.append('imagesFiles', new File([fs.readFileSync(p)], path.basename(p), { type: 'image/jpeg' }));
  }
  // MAXIMUM photogrammetry quality. Per docs.kiriengine.app:
  //   modelQuality  3 = Ultra (highest)   textureQuality 3 = 8K (highest)
  //   textureSmoothing 0 = Off (on reduces sharpness — not for pro work)
  //   isMask 1 = auto-isolate the subject. Quality does not change the
  //   per-scan credit cost, so max is free — only slower/larger output.
  form.append('modelQuality', process.env.KIRI_MODEL_QUALITY || '3');
  form.append('textureQuality', process.env.KIRI_TEXTURE_QUALITY || '3');
  form.append('isMask', '1');
  form.append('textureSmoothing', '0');
  form.append('fileFormat', 'obj');

  onLog(`KIRI: uploading ${imagePaths.length} images`);
  const created = await kiriFetch(`${KIRI_BASE}/photo/image`, { method: 'POST', body: form });
  const serialize = created?.data?.serialize;
  if (!serialize) throw new Error(`KIRI create returned no serialize token: ${JSON.stringify(created).slice(0, 300)}`);
  onLog(`KIRI: scan created, serialize=${serialize}`);
  if (opts.onSerialize) opts.onSerialize(serialize);

  await pollUntilDone(serialize, onLog);
  return downloadKiriModel(serialize, destDir, onLog);
}

// Never let a flaky status check trigger a new paid scan: retry the probe,
// and if it still fails, abort (a later retry is free) rather than re-pay.
async function checkPriorScan(serialize, onLog) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const st = await kiriFetch(`${KIRI_BASE}/model/getStatus?serialize=${serialize}`);
      const status = Number(st?.data?.status);
      if (status === 2) return 'success';
      if (status === 1) return 'failed';
      if (status === 4) return 'expired';
      return 'running';
    } catch (err) {
      onLog(`KIRI: earlier-scan check error (${err.message}), attempt ${attempt}/3`);
      if (attempt === 3) {
        throw new Error(`Could not check the earlier scan — retry again later instead of paying for a new one: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function pollUntilDone(serialize, onLog) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let pollErrors = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    let status;
    try {
      const statusRes = await kiriFetch(`${KIRI_BASE}/model/getStatus?serialize=${serialize}`);
      status = Number(statusRes?.data?.status);
      pollErrors = 0;
    } catch (err) {
      pollErrors += 1;
      onLog(`KIRI: status poll error (${err.message}), retry ${pollErrors}/5`);
      if (pollErrors >= 5) throw new Error(`KIRI status polling failed 5 times in a row (scan ${serialize} may still finish — retry resumes it free): ${err.message}`);
      continue;
    }
    onLog(`KIRI: status=${status}`);
    if (status === 1) throw new Error('KIRI reports the scan failed. Check capture quality.');
    if (status === 4) throw new Error('KIRI reports the scan expired.');
    if (status === 2) return;
  }
  throw new Error(`KIRI scan timed out after 45 minutes (serialize=${serialize}) — retry resumes it without a new charge.`);
}

async function downloadKiriModel(serialize, destDir, onLog) {
  const zipRes = await kiriFetch(`${KIRI_BASE}/model/getModelZip?serialize=${serialize}`);
  const modelUrl = zipRes?.data?.modelUrl || zipRes?.data?.url;
  if (!modelUrl) throw new Error(`KIRI returned no model URL: ${JSON.stringify(zipRes).slice(0, 300)}`);

  onLog('KIRI: downloading model zip');
  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`Downloading KIRI model failed: HTTP ${res.status}`);
  const dest = path.join(destDir, 'rough_model.zip');
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return { file: dest, kind: 'zip' };
}

async function mockRecon(destDir, onLog) {
  onLog('mock recon: simulating photogrammetry (20s)');
  await new Promise((r) => setTimeout(r, 20000));
  const dest = path.join(destDir, 'rough_model.gltf');
  fs.copyFileSync(path.resolve('assets/mock.gltf'), dest);
  return { file: dest, kind: 'gltf' };
}
