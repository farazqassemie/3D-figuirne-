# Figurine MVP — photo → 3D model test app

Minimal webapp to test the phone-to-figurine business, with real gen-AI APIs and a
stopwatch on every provider call.

The customer picks an **engine** on the home page, then takes **6 guided photos**; the AI
engine generates a 3D model from them. **The AI-generated mesh is the final deliverable**
(handed to artists for finishing) — there is no video capture and no photogrammetry step.

- **Option 1 — Rodin:** fast, best full-body figurine.
- **Option 2 — Hi3D:** highest detail / best face likeness. Sub-choice of **figurine** or
  **portrait** (Hi3D has a dedicated portrait model; Rodin is figurine-only).

The choice is passed to the photo screen as URL params (`?engine=…&subject=…`) and travels
with the job to the generation engine.

## Run

```
npm install
npm start          # http://localhost:3000
```

Open on your phone (same wifi): `http://<your-mac-ip>:3000`.

## Providers

Copy `.env.example` to `.env`.

| Engine | Provider | Key | Notes |
|---|---|---|---|
| Rodin | Rodin Gen-2.5 via fal.ai | `FAL_KEY` from fal.ai/dashboard/keys | ~$0.40/gen, pay-as-you-go |
| Hi3D | Hi3D (hitem3d.ai) | `HI3D_CLIENT_ID` + `HI3D_CLIENT_SECRET` from platform.hi3d.ai/console/apiKey | figurine + portrait models |

**No keys = mock mode**: the journey runs with a placeholder model and a simulated delay
(8s), so the UX is testable for free.

### Hi3D

When both `HI3D_CLIENT_ID` and `HI3D_CLIENT_SECRET` are set, **Option 2** on the home page
becomes selectable (otherwise it shows a "add your Hi3D key" note and is disabled).

**Hi3D is locked to maximum quality in code** — verified via a 4-agent audit of the live docs
as Hi3D's true top tier, with nothing higher available: `1536pro` resolution, `2,000,000`
polygons, PBR on, geometry+texture in one pass (`request_type=3`), GLB output (the only formats
that carry PBR maps are glb/usdz/fbx — obj/stl silently drop them). These are **not**
env-tunable, so a fast/low-quality tier can't slip in. It polls for as long as the job needs;
an interrupted run resumes the **same** task on retry via the stored `task_id`, so a restart
never pays twice.

**Multi-view is used and done correctly.** Hi3D reads `multi_images` positionally as
front/back/left/right, so the app sends only those canonical views (front required), in that
order, with a `multi_images_bit` mask of which are present (e.g. `"1011"` = front+left+right).
Omitting the bit would make Hi3D mislabel a partial set — so it's always sent. The photo
screen maps its slots (Front→front, Back of head→back, Left side→left, Right side→right) and
drops the 45° angles for Hi3D (they have no canonical slot). Multi-view resolves occluded
back/side geometry and costs the same as a single image.

Verify a real key with one generation before relying on it (`HI3D_ENABLED=0` hides it
meanwhile). If the API ever rejects the `multi_images` array, `HI3D_MULTIVIEW=0` falls back to
single-image. See `.env.example` for the (few) adjustable `HI3D_*` vars.

## Timing dashboard

`/admin.html` — per-job generation time, engine, subject, success/failure, and (best-effort)
the Hi3D account balance. This is the page that answers "how fast / how costly is each engine."

Job records (full logs + timings as JSON): `data/jobs/`. Uploaded photos & generated models:
`data/uploads/<jobId>/`.

## Not wired up right now

The KIRI photogrammetry provider (`lib/providers/recon.js`) and the video frame-extraction
helper (`lib/frames.js`) are **left on disk but no longer imported** — the app is photos →
AI mesh only. `KIRI_KEY` is currently unused. Re-wire them if you want the video-fed real-scan
path back.

## What is deliberately NOT here (MVP)

Payments, accounts, email, queue persistence across restarts (in-flight jobs die with the
server; records survive), consent copy, rate limiting, HTTPS.
