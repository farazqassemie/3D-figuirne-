import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { getJob, update, timed, logEvent, jobDir } from './store.js';
import { generatePreview, resolvePreviewProvider } from './providers/preview.js';

export function publicPath(absPath) {
  return '/files/' + path.relative(path.resolve('data'), absPath).split(path.sep).join('/');
}

// reuseMesh: on a retry after a download-stage failure, re-fetch the already
// paid-for mesh / resume the same task instead of paying for a new generation.
// A regenerate from preview_ready (customer wants a different result) must NOT
// reuse it.
export async function runPreview(jobId, imagePaths, { reuseMesh = false } = {}) {
  const job = getJob(jobId);
  const provider = resolvePreviewProvider(job);
  const priorMeshUrl = reuseMesh ? job.falMeshUrl : null;
  const priorTaskId = reuseMesh ? job.hi3dTaskId : null;
  update(jobId, {
    status: 'preview_running',
    error: null,
    ...(reuseMesh ? {} : { falMeshUrl: null, hi3dTaskId: null }),
    providers: { ...job.providers, preview: provider },
  });
  try {
    const glb = await timed(jobId, 'AI preview', provider, () =>
      generatePreview(imagePaths, jobDir(jobId), {
        provider,
        subject: job.subject,
        multiViewBit: job.multiViewBit,
        priorMeshUrl,
        priorTaskId,
        onMeshUrl: (url) => update(jobId, { falMeshUrl: url }),
        onTaskId: (id) => update(jobId, { hi3dTaskId: id }),
        onLog: (m) => logEvent(jobId, m),
      })
    );
    update(jobId, {
      status: 'preview_ready',
      files: { ...getJob(jobId).files, preview: publicPath(glb) },
    });
  } catch (err) {
    update(jobId, { status: 'preview_failed', error: err.message });
  }
}

// Bake in EXIF orientation (some providers ignore the flag and see sideways
// people) and keep MAXIMUM resolution. Hi3D's texture detail comes straight
// from the input pixels, so downscaling a 24MP phone photo to 2048px — as this
// used to — threw away ~85% of the facial detail and is what made API results
// look softer than Hi3D's own web UI. We keep full resolution at high quality
// and only step down if a photo would exceed the provider's ~20MB/image limit.
async function normalizePhotos(imagePaths, jobId) {
  const out = [];
  // Hi3D caps multi-view images at 10MB EACH (single-image is 20MB). Stay under
  // 10MB so multi-view uploads are never rejected. A tightly-framed head/bust
  // easily fits this at full quality; only a full-frame 24MP shot gets nudged
  // down — and downscaling preserves more detail than lowering JPEG quality.
  const MAX_BYTES = 9.5 * 1024 * 1024;
  let downscaled = 0;
  let passthrough = 0;
  for (const p of imagePaths) {
    const dest = p.replace(/\.[^.]+$/, '') + '_n.jpg';
    const meta = await sharp(p).metadata().catch(() => ({}));
    const needsRotate = meta.orientation && meta.orientation !== 1;
    const isJpeg = /jpe?g/i.test(meta.format || '');
    const origSize = fs.statSync(p).size;
    // ZERO-LOSS passthrough: an already-upright JPEG within the size limit is
    // sent byte-for-byte — no re-compression, so not a single pixel of detail
    // is lost. (This is what the vendor's own web UI effectively does.)
    if (isJpeg && !needsRotate && origSize <= MAX_BYTES) {
      fs.copyFileSync(p, dest);
      out.push(dest);
      passthrough += 1;
      continue;
    }
    // Otherwise bake EXIF rotation at MAXIMUM quality — q100 with 4:4:4 chroma
    // (no chroma subsampling), downscaling only if a photo would exceed 20MB.
    const enc = { quality: 100, chromaSubsampling: '4:4:4' };
    let buf = await sharp(p).rotate().jpeg(enc).toBuffer();
    while (buf.length > MAX_BYTES) {
      const m = await sharp(buf).metadata();
      const width = Math.max(1536, Math.round(m.width * 0.85));
      buf = await sharp(p).rotate().resize({ width, withoutEnlargement: true }).jpeg(enc).toBuffer();
      downscaled += 1;
      if (width <= 1536) break;
    }
    fs.writeFileSync(dest, buf);
    out.push(dest);
  }
  logEvent(
    jobId,
    `normalized ${out.length} photos at MAX detail — ${passthrough} sent untouched (zero loss), ` +
      `${out.length - passthrough} rotated at q100/4:4:4${downscaled ? `, ${downscaled} stepped to fit 20MB` : ''}`
  );
  return out;
}

export async function startFlow3(jobId, imagePaths) {
  let photos;
  try {
    photos = await normalizePhotos(imagePaths, jobId);
  } catch (err) {
    // Un-decodable input (commonly iPhone HEIC — sharp can't decode it). NEVER
    // ship the raw bytes to a paid engine — that just burns a generation on
    // input it can't read (exactly what happened on job cdd2b0…). Fail fast.
    logEvent(jobId, `photo normalization failed (${err.message}) — failing job instead of sending unreadable photos to a paid engine`);
    update(jobId, {
      status: 'preview_failed',
      error:
        'We couldn’t read one or more of your photos. Please upload JPEG or PNG images. ' +
        '(On iPhone: Settings → Camera → Formats → “Most Compatible”, or share/export the photos as JPEG first.)',
    });
    return;
  }
  update(jobId, { files: { ...getJob(jobId).files, photos: photos.map(publicPath) } });
  await runPreview(jobId, photos.slice(0, 5));
}

// The AI preview mesh IS the deliverable now (no photogrammetry step) —
// approving is the customer placing the order.
export async function approveJob(jobId) {
  update(jobId, { status: 'done', approvedAt: new Date().toISOString() });
}
