import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const run = promisify(execFile);

const LAPLACIAN = {
  width: 3,
  height: 3,
  kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
};

async function sharpness(file) {
  const stats = await sharp(file)
    .resize({ width: 480 })
    .grayscale()
    .convolve(LAPLACIAN)
    .stats();
  return stats.channels[0].stdev;
}

export async function extractFrames(videoPath, outDir, { fps = 3 } = {}) {
  // Wipe leftovers from any earlier attempt — mixed frame sets from two
  // different videos would poison the paid photogrammetry scan.
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  await run('ffmpeg', [
    '-i', videoPath,
    '-vf', `fps=${fps}`,
    '-qscale:v', '2',
    path.join(outDir, 'frame_%04d.jpg'),
  ]);
  return fs
    .readdirSync(outDir)
    .filter((f) => f.startsWith('frame_'))
    .sort()
    .map((f) => path.join(outDir, f));
}

// Bucket frames over time and keep the sharpest per bucket, preserving orbit
// coverage — photogrammetry needs views spread around the subject, not just
// the N sharpest frames which may cluster in one arc.
export async function selectFrames(frames, targetCount) {
  const scored = [];
  for (const f of frames) {
    scored.push({ file: f, score: await sharpness(f) });
  }
  if (scored.length <= targetCount) return scored.map((s) => s.file);

  const selected = [];
  const bucketSize = scored.length / targetCount;
  for (let i = 0; i < targetCount; i++) {
    const bucket = scored.slice(Math.floor(i * bucketSize), Math.floor((i + 1) * bucketSize));
    if (!bucket.length) continue;
    bucket.sort((a, b) => b.score - a.score);
    selected.push(bucket[0].file);
  }
  return selected;
}

// Preview engines take at most 4-5 views; pick frames at quarter points of the
// orbit so the model sees front/side/back/side rather than adjacent frames.
export function pickPreviewViews(orderedFrames, count = 4) {
  if (orderedFrames.length <= count) return orderedFrames;
  const views = [];
  for (let i = 0; i < count; i++) {
    views.push(orderedFrames[Math.floor((i * orderedFrames.length) / count)]);
  }
  return views;
}
