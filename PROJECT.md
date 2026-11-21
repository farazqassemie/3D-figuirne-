# Figurine Studio (figurine-mvp): complete project handbook

> **Purpose of this file.** This is the single, complete description of the project: what it is, every file, every rule, every decision, its full history and how to rebuild it from nothing. It is written so that a person or another AI that has never seen the project can understand it in detail and continue the work.
>
> Last updated: 2026-11-21. Last code commit described: `839a2c5`.

---

## 0. Quick facts

| Item | Value |
|---|---|
| What it is | A web app. A customer uploads phone photos of a person and gets an AI-generated 3D model (GLB file). They can download it, or pay to have it 3D-printed as a figurine (5, 10 or 15 cm). |
| Market | United States (US legal pages, US shipping only, USD prices) |
| Stack | Node.js 20, Express 4 (ES modules), multer (uploads), sharp (image processing), `@fal-ai/client`, plain HTML/CSS/JS front end (no framework, no build step), Google `<model-viewer>` for the 3D viewer |
| Database | None. JSON files on disk in `data/` (jobs, passes, payments) plus uploaded files in `data/uploads/<jobId>/` |
| AI engines | **Model 1** = Rodin Gen-2.5 via fal.ai. **Model 2** = Hi3D (hitem3d.ai): Figurine v2.1, Figurine v3.0, Portrait |
| Hosting | Railway, US East, 1 replica, persistent volume at `/app/data`, Docker build, auto-deploys on every push to `main` |
| Live URL (testing) | https://3d-figuirne-production.up.railway.app |
| Admin dashboard | `https://<host>/admin.html?token=<ADMIN_TOKEN>` |
| Code | GitHub `farazqassemie/3D-figuirne-` (branch `main`). Local copy on the owner's Mac: `~/Desktop/right side desktop/3dmodel` |
| Railway project name | "invigorating-possibility" |
| Payments | **Test mode only.** No real payment provider is connected yet. The owner will choose one (Stripe, Square, PayPal …) later. |
| Status | Client testing phase. A custom domain is to be added only after the client approves. |

---

## 1. What the product does (customer journey)

1. **Home page** (`/index.html`). The customer sees two cards:
   - **Model 1** ("Fast · best full-body figurine"): button "Make a figurine".
   - **Model 2** ("Highest detail · best face likeness"): three buttons: "Figurine v2.1", "Figurine v3.0", "Portrait".
   - Options can be **locked** (visible, faded, with a small "Locked" second line, not clickable). By default **Model 1 and Model 2 Figurine v2.1 are locked**, so customers can use **Model 2 Figurine v3.0** and **Model 2 Portrait** only.
   - The intro says "From $2.99". If the browser remembers a pass, a "My generations & models" link appears.
2. **Upload page** (`/flow3.html?engine=…&subject=…`):
   - A banner shows what is being made ("Model 2 · figurine v3.0") with a "change" link.
   - A **photo guide image** for the chosen option, plus written tips ("For the best likeness").
   - **Photo slots** (compact grid):
     - Model 1: 6 slots (Front, Front-left 45°, Left side, Front-right 45°, Right side, Back of head) in 3 columns; needs at least 4.
     - Model 2 Figurine (v2.1/v3.0): 4 slots (Front, Back, Left side 90° "face the right edge", Right side 90° "face the left edge") in 4 columns; needs Front plus at least one more.
     - Model 2 Portrait: 1 slot (Front photo, head and shoulders).
   - Photos can be picked or dragged onto slots; dropping several on the grid fills empty slots in order.
   - **Four required consent checkboxes** (age 18+, rights/permission for everyone shown, biometric processing including by providers possibly in China/Hong Kong, Terms + Privacy). The Create button stays disabled until photos are OK **and** all four are ticked.
   - If the customer has a pass, a bar says "You have N generations left" with a "copy my link" button.
3. **Click "Create my 3D preview"**:
   - **Has generations left** → photos upload, 1 generation is used, generation starts, the browser goes to the result page.
   - **No generations** → the **price box** opens (1 generation $2.99, 2 for $4.99, 3 for $6.99 "Try different outfits or different people"), plus an email field. On "Continue to payment" the photos are first saved on the server as an **unpaid draft**, then the customer goes to the payment page.
4. **Payment page** (`/pay.html`). Shows what is paid for and the amount. In test mode a yellow "Test mode" note and a "Pay $X (test)" button. Paying adds the generations to the pass, **automatically uses one and starts the draft's generation**, and sends the customer to the result page.
5. **Result page** (`/review.html?job=…&t=…&pass=…&pt=…`):
   - While running: spinner and stopwatch ("Building your 3D model").
   - When ready: the spinning 3D model, then:
     - **"Download 3D file (included)"** (free).
     - **"Order a 3D print"** → size choice (5 cm $50, 10 cm $80, 15 cm $120) + US shipping form → payment page → "Order placed 🎉" with the address.
     - **"Regenerate (uses 1 generation)"** → confirm; if there are no generations left, the price box opens to top up.
     - "My generations & models" link and a table of generation times.
   - Failed: error message + "Try again" (free; resumes the already-paid run).
   - Always (when nothing is running): **"Delete my photos and model"** (permanent).
6. **My generations page** (`/pass.html?pass=…&pt=…`): generations left/used, "Make a new model", "Buy more generations", copy private link, list of all the customer's models with status and open links.

There are **no accounts or passwords**. A customer's "pass" (their paid generations) is reached by a **private link** (pass id + secret token). The email is stored with the pass (for sending the link and receipts; email sending is **not built yet**). The browser also remembers the pass in `localStorage` under key `figurinePass`.

---

## 2. History: everything that was done, in order

| Date | Commit | What changed |
|---|---|---|
| 2026-07-21 | `c910115` | First version: photo → 3D bust with Rodin (fal.ai) and Hi3D, per-job secret tokens, Docker/Render deploy config. (Earlier experiments with video capture + KIRI photogrammetry were dropped; their code stays on disk unused.) |
| 2026-07-21 | `c0243b0` | Portrait asks for a single front photo (Hi3D's portrait model works best with one sharp front image). |
| 2026-11-11 | `0d0d9d0`, `de7db19` (PR #1) | Railway config (`railway.json`) and Railway as primary host. |
| 2026-11-14 | `4d4142d` | Admin: Download button for each job's .glb. |
| 2026-11-14 | `896e540`, `bac6ddb` | Model 2: added Hi3D v3.0 figurine option next to v2.1. |
| 2026-11-14 | `53ee1df` | Model 2 figurine shows only the 4 used slots; clear left/right wording. |
| 2026-11-14 | `ae559f8`, `841fd3e` | Upload page shows an example photo board per option; full-body wording; guide images added. |
| 2026-11-14 | `315e84f` | Lock Model 1 and Model 2 Figurine v2.1 (faded "Locked" buttons; server rejects them too). |
| 2026-11-14 | (deploy) | Deployed on Railway for client testing. |
| 2026-11-16 | `71c929a` | Admin page shows each job's uploaded photos as labelled thumbnails. |
| 2026-11-16 | `8154550` | US legal basics: Terms, Privacy Policy with Biometric Data Notice, required consent checkboxes, automatic deletion (retention), customer delete button. |
| 2026-11-16 | `9c4e23d` | Paid generations (packs) and print orders, in test payment mode; compact photo slots. |
| 2026-11-16 | `694d401` | 3-pack price confirmed at $6.99. |
| 2026-11-16 | `3d47215` | Compact home page (smaller cards/buttons, "Locked" as a small second line). |
| 2026-11-16 | `5866a97` | Price box opens on "Create my 3D preview" (after photos), not on the home page; photos saved as an unpaid draft and generation starts automatically after payment. |
| 2026-11-17 | `839a2c5` | New Model 1 photo guide image (Front, Left side 90°, Right side 90°, Back, a top-down camera-position diagram "same distance ≈ 2.5–3 m, use 2× zoom", and tips: same pose, camera at chest height, soft even light, plain background). |
| 2026-11-21 | (this file) | `PROJECT.md` added. |

### Decisions the owner made (keep these)
- Engines are shown to customers only as **"Model 1" / "Model 2"**. Vendor names (Rodin, fal, Hi3D) are never shown to customers.
- Pricing: packs **1 / 2 / 3 generations = $2.99 / $4.99 / $6.99**. Prints **5 cm $50, 10 cm $80, 15 cm $120**.
- **Regenerate uses 1 generation.** A retry after a failure is free.
- **Email + private link** instead of accounts.
- **Download of the digital file is included** in the generation price.
- The price box must appear **on the upload page after photos are added**, when "Create" is clicked, not on the home page.
- Hosting on Railway (Vercel was rejected: jobs run up to an hour and data lives on disk). Custom domain only after the client approves.
- Payment provider: **to be chosen later** by the owner.

### Owner's working rules (for anyone continuing this work)
- **Never start a paid AI generation** (real Rodin/Hi3D call) without the owner's explicit go-ahead. Testing uses the free **mock** engine.
- Never read or print `.env` or any secret values; never type card numbers, passwords or API keys anywhere.
- Ask before granting app access/OAuth.
- Keep the owner's personal email private.
- Communicate in plain, simple English; the owner is not a programmer.

---

## 3. Architecture

```
Browser (static pages in /public)
   │  fetch JSON / multipart
   ▼
server.js (Express) ── lib/store.js ........ data/jobs/<id>.json
   │                 ── lib/commerce.js ..... data/passes/<id>.json, data/payments/<id>.json
   │                 ── lib/retention.js .... deletes old files (hourly)
   │                 ── lib/pipeline.js ..... normalize photos → run engine → save GLB
   │                         └ lib/providers/preview.js → fal.ai Rodin | Hi3D API | mock
   └ /files/uploads/<jobId>/<file>  (served only with the job token or admin token)
```

- **One single process.** Generations run in the background inside the server process (a promise that polls the vendor for up to 60 minutes). That is why it must be **one instance** with a **persistent disk**.
- On restart, jobs that were running are marked retryable (`sweepInterrupted`).
- Statelessness is **not** a goal; the disk is the database.

### Folder layout

```
3dmodel/
├── server.js                 Express app: all routes, upload handling, consent, credit checks
├── package.json              "type": "module"; start = node server.js
├── package-lock.json
├── Dockerfile                node:20-bookworm-slim, npm ci --omit=dev, CMD node server.js
├── railway.json              Dockerfile build, 1 replica, healthcheck /api/config, restart on failure
├── render.yaml               Alternative host (Render blueprint, 10 GB disk) – not used now
├── .env.example              All environment variable names with explanations
├── .gitignore / .dockerignore
├── .claude/launch.json       Local dev server config (npm start, port 3000)
├── README.md, DEPLOY.md      Older docs (partly out of date: they still say "no payments")
├── PROJECT.md                This file
├── assets/mock.gltf          Placeholder model used by the free mock engine
├── lib/
│   ├── store.js              Job JSON store + timing/log helpers
│   ├── pipeline.js           Photo normalization, running the engine, saving the result
│   ├── commerce.js           Prices, passes (credits), payments, checkout, fulfilment
│   ├── retention.js          Automatic deletion + customer deletion
│   ├── frames.js             UNUSED (old video-frame extraction)
│   └── providers/
│       ├── preview.js        The AI engines (Rodin, Hi3D, mock), locks, engine list
│       └── recon.js          UNUSED (old KIRI photogrammetry)
├── public/                   Everything the browser loads (no build step)
│   ├── index.html            Home page (option cards)
│   ├── flow3.html            Upload page (guide, slots, consent, Create, price box trigger)
│   ├── review.html           Result page (viewer, download, print order, regenerate, delete)
│   ├── pay.html              Test payment page
│   ├── pass.html             "My generations" private page
│   ├── admin.html            Owner dashboard (jobs, photos, customers, print orders, timings)
│   ├── terms.html            Terms of Service
│   ├── privacy.html          Privacy Policy + Biometric Data Notice + retention schedule
│   ├── checkout.js           Shared price box + pass memory helpers
│   ├── legal.js              Shared legal footer + fills business details on legal pages
│   ├── style.css             All shared styles
│   ├── guide-model1.webp     Photo guide image for Model 1 (78 KB)
│   ├── guide-model2-figurine.webp  Photo guide for Model 2 figurines (80 KB)
│   └── guide-portrait.webp   Photo guide for Model 2 portrait (140 KB)
├── scripts/merge_head_body.py  Blender experiment: put a Hi3D portrait head on a body (not used by the app)
└── data/                     NOT in git. Runtime data (Railway volume /app/data)
    ├── jobs/<id>.json
    ├── passes/<id>.json
    ├── payments/<id>.json
    └── uploads/<jobId>/      photos (*_n.jpg normalized copies) and preview.glb
```

Local-only files not in git: `.env` (secret keys), `.webpb-active`, `.webpb-approved` (markers from an unrelated tooling setup; ignore), `data/` (also holds old merge-experiment renders like `hybrid_figure.glb`, `merged_figure.glb`, PNGs).

---

## 4. Data model

All ids are **12 hex characters** (`crypto.randomBytes(6)`); secret tokens are **32 hex characters** (`randomBytes(16)`). Files are written atomically (write `.tmp`, then rename).

### 4.1 Job (`data/jobs/<id>.json`)
```js
{
  id, token,                 // token = capability to view this job and its files
  flow: 3,
  status,                    // see state machine below
  createdAt,                 // ISO date
  engine: 'model1'|'model2', // customer choice (absent = default provider)
  subject: 'figurine'|'figurine-v3'|'portrait',
  multiViewBit: '1011',      // Model 2: which of front/back/left/right were sent
  providerOverrides: { preview: 'mock'|'fal-rodin'|'hi3d' },  // internal ?preview= test pin
  providers: { preview: 'hi3d' },
  consent: { version: '2026-11-16', at, consentAge: true, consentRights: true,
             consentBiometric: true, consentTerms: true, userAgent },
  passId,                    // which pass paid for it (null for owner tests)
  draftFiles: [absPaths],    // only while status = 'draft'
  files: { photos: ['/files/uploads/<id>/x_n.jpg', …], preview: '/files/uploads/<id>/preview.glb' },
  falMeshUrl, hi3dTaskId,    // remembered so a retry never pays twice
  timings: [{ stage: 'AI preview', provider, ms, ok }],
  log: [{ at, message }],
  error,
  printOrder: { size: '10 cm', sizeId: 'cm10', cents: 8000,
                shipping: { name, line1, line2, city, state, zip, phone },
                status: 'awaiting_payment'|'paid', paymentId, createdAt, paidAt },
  approvedAt,                // set when the print order is paid
  photosDeletedAt, deletedAt, deletedReason
}
```

**Job status state machine**
```
created ──(rejected upload)──────────────► failed
created ──draft upload──► draft ──paid──► uploaded
created ──paid upload───────────────────► uploaded ──► preview_running ──► preview_ready ──print paid──► done
                                                              └──────────► preview_failed ──Try again──► preview_running
preview_ready ──Regenerate (1 credit)──► preview_running
any finished state ──customer delete / retention──► deleted
restart: preview_running → preview_failed; created/uploaded → failed
unpaid draft older than 1 day → deleted
```

### 4.2 Pass (`data/passes/<id>.json`): a customer's paid generations
```js
{ id, token, email, credits, used, paid, jobs: [jobId…],
  history: [{ at, jobId?, change: -1|+N, why, paymentId? }], createdAt }
```
`remaining = credits - used`. `useCredit()` is synchronous (Node is single-threaded), so two requests can't both take the last credit.

### 4.3 Payment (`data/payments/<id>.json`)
```js
{ id, token, kind: 'pack'|'print', status: 'pending'|'paid', provider: 'test',
  cents, currency: 'USD', description,
  // pack:
  passId, packId, generations, next: { engine, subject, draftJobId },
  // print:
  jobId, sizeId,
  createdAt, paidAt, providerRef }
```

---

## 5. HTTP API (server.js)

Auth styles: **job token** `?t=` or header `x-job-token`; **pass token** `?pt=`; **payment key** `?k=`; **admin token** `?token=` or header `x-admin-token` (works as a master key for jobs and files).

| Method & path | Who | What |
|---|---|---|
| `GET /` and static files | anyone | `public/` |
| `GET /files/uploads/<jobId>/<file>` | job token or admin | Serves that job's photos/model only. Rejects other paths, `..`, missing token (403). Adds `X-Content-Type-Options: nosniff`. |
| `POST /api/flow3` | anyone | Multipart upload (`photos` up to 8 files, 60 MB each, JPEG/PNG/WebP only; extension taken from the MIME type, never the filename). Fields: `consentVersion`, 4 consent fields `=yes`, `engine`, `subject`, `multiViewBit`, and either `draft=1` or `pass`+`pt`. Order of checks: consent → engine available → not locked → minimum photos (Model 1: 4; Model 2 figurine: 2; portrait: 1) → draft branch **or** pass with credits (402 otherwise) → use 1 credit → store consent → start generation. Any rejection deletes the uploaded files. Returns `{ jobId, token }` (+ `draft: true`). Admin token skips payment ("owner test mode"). |
| `GET /api/jobs/:id` | job token/admin | The job without its token. |
| `POST /api/jobs/:id/approve` | – | Always 410 (orders are placed by paying for a print). |
| `POST /api/jobs/:id/regenerate` | job token/admin | Allowed from `preview_ready` (uses 1 credit unless admin; 402 `needCredits` if none) or `preview_failed` (free; reuses the paid mesh/task). Blocked if locked (for new runs), already print-ordered, or no usable photos. |
| `POST /api/jobs/:id/delete` | job token/admin | Deletes photos + model (not while running). |
| `POST /api/jobs/:id/print-checkout` | job token/admin | Body `{ size: 'cm5'|'cm10'|'cm15', shipping: {…} }`. Validates US address (2-letter state, 5 or 9-digit ZIP). Returns `{ payUrl }`. |
| `GET /api/pricing` | anyone | `{ currency, packs, printSizes, provider }` |
| `POST /api/checkout/pack` | anyone | Body `{ pack, email | (pass, pt), engine, subject, draftJob, draftToken }`. Creates/tops up a pass and a pending payment. Returns `{ payUrl: 'pay.html?p=ID&k=KEY' }`. |
| `GET /api/payments/:id?k=` | payment key | Amount/description; `next` URL once paid. |
| `POST /api/payments/:id/test-complete?k=` | payment key, **test mode only** | Marks paid via `fulfillPayment` (404 when `PAYMENTS_PROVIDER` ≠ `test`). |
| `GET /api/passes/:id?pt=` | pass token | Credits, used, remaining, list of jobs (with their tokens, so the owner of the link can open them). |
| `GET /api/jobs` | admin | All jobs (tokens removed) + `customerEmail`. |
| `GET /api/hi3d/balance` | admin | Hi3D account balance (best effort). |
| `GET /api/config` | anyone | `{ preview: default provider }` (also the health check). |
| `GET /api/engines` | anyone | Engines + subjects + `locked` flags (drives the home page). |
| `GET /api/legal` | anyone | Business details from env vars, retention days, consent version. |

Error handler: multer errors → 400/413 with friendly text; errors with `.status` keep it; new jobs that fail have their upload folder wiped.

---

## 6. The AI engines (lib/providers/preview.js)

`resolvePreviewProvider(job)`: `providerOverrides.preview` (internal test pin) → customer `engine` (`model1`→`fal-rodin`, `model2`→`hi3d`) → default (`PREVIEW_PROVIDER` env, else `fal-rodin` if `FAL_KEY` set, else `mock`).

`availablePreviewEngines()`: Model 1 appears only if `FAL_KEY` is set (or `PREVIEW_PROVIDER=fal-rodin`); Model 2 only if both `HI3D_CLIENT_ID` and `HI3D_CLIENT_SECRET` are set and `HI3D_ENABLED` ≠ `0`. If neither: a "Mock" engine.

**Locks:** `LOCKED_OPTIONS` env, comma list of `engine` or `engine:subject`. Default `model1,model2:figurine`. `none` unlocks everything. Locked options are shown but the server refuses them (409) and the upload page hides the form.

### 6.1 Mock
Waits 8 s and copies `assets/mock.gltf` to `preview.gltf`. Free. Used for all testing.

### 6.2 Model 1: Rodin via fal.ai
- Uploads each photo to fal storage, then `fal.subscribe(endpoint, { input, timeout: FAL_MAX_WAIT_MS || 60 min })`.
- Default endpoint `fal-ai/hyper3d/rodin/v2.5` with: `image_urls`, `tier: 'Gen-2.5-Extreme-High'`, `geometry_file_format: 'glb'`, `material: 'PBR'`, `quality_mesh_option: '2M Triangle'`, `texture_mode: 'high'`, `hd_texture: true`, `is_micro: true`, `addons: { high_pack: true }`; creative mode off (hurts likeness).
- Env overrides: `RODIN_VERSION=v2` (old endpoint `fal-ai/hyper3d/rodin`), `RODIN_TIER`, `RODIN_MESH`, `RODIN_TEXTURE`, `RODIN_HDTEX=0`, `RODIN_MICRO=0`, `RODIN_HIGHPACK=0`, `RODIN_DELIGHT=1`, `RODIN_CREATIVE=1`, `RODIN_QUALITY`, `RODIN_HYPER`.
- Finds the first `.glb` URL anywhere in the response, saves it as `preview.glb`. Mesh URL is stored so a retry re-downloads instead of paying again.
- Cost noted earlier: about $0.40 per generation at normal tier (Extreme-High bills more).
- Photo order sent: front, front-left 45°, front-right 45°, left side, right side, back (max 5 used).

### 6.3 Model 2: Hi3D (hitem3d.ai)
- Base `https://api.hitem3d.ai`. Auth: `POST /open-api/v1/auth/token` with `Authorization: Basic base64(client_id:client_secret)` → `data.accessToken` (Bearer).
- Submit: `POST /open-api/v1/submit-task` (multipart) with **locked maximum quality**: `request_type=3` (geometry + texture), `resolution=1536pro`, `face=2000000`, `pbr=1`, `format=2` (GLB). Model:
  - Figurine v2.1: `hitem3dv2.1` (env `HI3D_FIGURINE_MODEL`, `HI3D_VERSION`)
  - Figurine v3.0: `hi3dv3.0` with resolution `2048quality` (v3.0 rejects 1536pro with error 10031003; `HI3D_V3_RESOLUTION=2048master` for the 145-credit tier; 2048quality = 45 credits, same as v2.1 1536pro)
  - Portrait: `scene-portraitv2.1` (env `HI3D_PORTRAIT_MODEL`)
- **Multi-view** (figurines): photos sent as `multi_images` in the fixed order **front, back, left, right** with `multi_images_bit` (e.g. `1011`) marking which exist. Used only if the bit's count of 1s matches the image count. `HI3D_MULTIVIEW=0` disables it.
- **Portrait** sends a **single front image** (multi-view averaging blurs faces). `HI3D_PORTRAIT_MULTIVIEW=1` forces 4-view.
- Poll `GET /open-api/v1/query-task?task_id=` every 8 s until `state=success` (states: created, queueing, processing, success, failed), up to `HI3D_MAX_WAIT_MS` (60 min). Code `50010001` or state `failed` = real failure (fail fast). Other errors retried up to 5 times in a row.
- **Never pays twice:** task id and mesh URL are saved on the job. A retry first re-downloads the saved URL, then re-checks the saved task (resume if still running, download if succeeded) and only submits a new task if the old one truly failed.
- Balance: `GET /open-api/v1/balance` → `data.totalBalance` (admin page).
- Hi3D's docs don't say whether "left" means the subject's left or the camera's left. The app's slots follow the guide image (Left side = person faces the RIGHT edge of the photo). **Not yet verified with a swap test.**

### 6.4 Photo normalization (lib/pipeline.js)
Before any engine: each photo becomes `<name>_n.jpg`. Upright JPEGs ≤ 9.5 MB are copied byte-for-byte (zero loss). Others are rotated per EXIF and re-encoded at JPEG quality 100, 4:4:4 chroma, downscaled in 15% steps (not below 1536 px wide) only if over 9.5 MB (Hi3D multi-view limit is 10 MB/image). If a photo can't be decoded (e.g. HEIC), the job fails **before** any paid call with an explanation about iPhone "Most Compatible" format.

---

## 7. Payments and credits (lib/commerce.js)

Prices are set **only** in `lib/commerce.js`:
```js
PACKS = [
  { id: 'pack1', generations: 1, cents: 299, label: '1 generation' },
  { id: 'pack2', generations: 2, cents: 499, label: '2 generations' },
  { id: 'pack3', generations: 3, cents: 699, label: '3 generations', note: 'Try different outfits or different people' },
];
PRINT_SIZES = [ { id: 'cm5', label: '5 cm', cents: 5000 }, { id: 'cm10', label: '10 cm', cents: 8000 }, { id: 'cm15', label: '15 cm', cents: 12000 } ];
```

- `paymentProvider()` = `PAYMENTS_PROVIDER` env, default `test`.
- `startPackCheckout` creates a pass (needs a valid email) or tops up an existing one (needs pass + token), validates the draft job (must be status `draft` with matching token, else "Your photos expired"), and creates a pending payment.
- `startPrintCheckout` requires the job to be `preview_ready`/`done` with a model and not already paid; stores `printOrder` with status `awaiting_payment`.
- `fulfillPayment(id, providerRef)` (**idempotent**): marks paid; for a pack adds credits, sets `paid`, then if there is a draft: uses 1 credit, sets the job to `uploaded` and starts generation; for a print sets the job `done`, `approvedAt`, `printOrder.status = 'paid'`.
- `afterPaymentUrl`: pack with a started draft → its review page; pack with an engine chosen → upload page; otherwise → pass page; print → review page.
- **Card details are never entered on this site.** When a real provider is chosen: create the provider's hosted checkout in place of `payUrl()` in `server.js`, add a webhook route that verifies the provider's signature and calls `fulfillPayment(paymentId, providerRef)`, set `PAYMENTS_PROVIDER` to the provider name (this automatically disables the test-complete endpoint), and update the Privacy Policy's payment-provider mention if needed.

Front end: `public/checkout.js` defines `openPackBox({ engine, subject, pass, pt, prepare })` (the modal), `savedPass()`, `rememberPass()`, `passLink()`. On the upload page `prepare` uploads the photos once as a draft (`draft=1`) and returns `{ draftJob, draftToken }`.

---

## 8. Legal, consent and privacy (US)

Built 2026-11-16. **This is not legal advice; a lawyer must review before a real launch.**

- **Terms of Service** (`public/terms.html`, effective 2026-11-16): 18+; uploader confirms photos are of them or they have permission (parent/guardian for minors) incl. biometric consent; licence to process photos only to provide the service; banned content (no consent, celebrities, nudity, minors' sexual content, IP infringement, deepfakes); AI results vary; personal non-commercial use of the model; **Section 6**: generation packs (each generation incl. regenerate uses one, failed runs retry free, download included, generations don't expire, unused packs refundable within 14 days, used ones not refundable) and print orders (custom products not refundable once production starts; damaged/defective within 14 days → repair/replace/refund); privacy and deletion; DMCA-style copyright notice; disclaimers; liability cap (greater of amount paid or $100); indemnity; governing law = `LEGAL_GOVERNING_STATE`, informal resolution first, small claims allowed; changes; contact.
- **Privacy Policy** (`public/privacy.html`): what's collected (photos, biometric info, model, email, shipping, purchase info, consent records, technical logs, messages); uses (no facial recognition, ads or AI training); sharing (3D providers possibly in China incl. Hong Kong, payment provider, US hosting, model-viewer CDN (unpkg), print/shipping partners, legal); no sale/sharing; **Section 4 Biometric Data Notice and Retention Schedule** (BIPA, Texas CUBI, Washington): consent first, no sale/profit, security, deletion schedule (photos after `PHOTO_RETENTION_DAYS`, models after `MODEL_RETENTION_DAYS`, immediately on request, never later than 3 years); other retention (consent/order records up to 7 years); no tracking cookies, honours GPC; state privacy rights list and how to request (delete button or email; 45-day response; appeals); children; security; international processing; changes; contact.
- Business name, email, address and state are **not hard-coded**: they come from env vars via `/api/legal` and are filled into `[data-legal]` spans by `public/legal.js`. Missing ones show a **yellow placeholder** like "BUSINESS NAME (set LEGAL_BUSINESS_NAME)". `legal.js` also adds the footer links (Terms · Privacy · Biometric Data Notice · Your Privacy Choices) to every page.
- **Consent**: 4 checkboxes on the upload page, required by the server; the job stores what was agreed, the version (`CONSENT_VERSION = '2026-11-16'`, set in **both** `server.js` and `flow3.html`; bump both when wording, Terms or Privacy change materially), time and browser.
- **Retention** (`lib/retention.js`, runs at boot and hourly): unpaid drafts deleted after 1 day; photos deleted `PHOTO_RETENTION_DAYS` (30) after `approvedAt` or `createdAt` (the model is kept); everything deleted after `MODEL_RETENTION_DAYS` (365). Running jobs are never touched. Deletion leaves a bare job record (status `deleted`, reason, date) for accounting.
- **Customer delete**: "Delete my photos and model" on the result page.

---

## 9. Security measures
- Every job has an unguessable token; files are only served with it (or the admin token). Job ids are validated as 12 hex chars; paths with `..` are rejected.
- Uploads: only JPEG/PNG/WebP by MIME type, stored extension from MIME (so no HTML/SVG can be stored), 60 MB limit, max 8 files.
- Admin endpoints need `ADMIN_TOKEN`; if it's not set they are locked (401).
- Tokens are never returned in job bodies or the admin list.
- Front-end output is escaped (`esc()`).
- Rejected uploads delete their photos immediately.
- Not done yet: rate limiting, CAPTCHA, email verification.

---

## 10. Environment variables

Set on Railway → service → Variables (never commit `.env`). `PORT` is provided by the host.

| Variable | Purpose | Default |
|---|---|---|
| `FAL_KEY` | fal.ai key → enables Model 1 | – |
| `HI3D_CLIENT_ID`, `HI3D_CLIENT_SECRET` | Hi3D keys (platform.hi3d.ai/console/apiKey) → enables Model 2 | – |
| `ADMIN_TOKEN` | Admin dashboard password-like token | – (admin locked) |
| `LOCKED_OPTIONS` | Locked options, e.g. `model1,model2:figurine`, or `none` | `model1,model2:figurine` |
| `PAYMENTS_PROVIDER` | `test` until a real provider is wired | `test` |
| `LEGAL_BUSINESS_NAME`, `LEGAL_CONTACT_EMAIL`, `LEGAL_MAILING_ADDRESS`, `LEGAL_GOVERNING_STATE` | Shown on Terms/Privacy | – (**still not set on Railway**) |
| `PHOTO_RETENTION_DAYS` / `MODEL_RETENTION_DAYS` | Auto-deletion | 30 / 365 |
| `PREVIEW_PROVIDER` | Force default engine: `fal-rodin` / `hi3d` / `mock` | auto |
| `HI3D_ENABLED=0` | Hide Model 2 | – |
| `HI3D_VERSION`, `HI3D_FIGURINE_MODEL`, `HI3D_V3_MODEL`, `HI3D_V3_RESOLUTION`, `HI3D_PORTRAIT_MODEL`, `HI3D_MULTIVIEW`, `HI3D_PORTRAIT_MULTIVIEW`, `HI3D_MAX_WAIT_MS` | Hi3D tuning (see §6.3) | max quality |
| `RODIN_*`, `FAL_MAX_WAIT_MS` | Rodin tuning (see §6.2) | max quality |
| `KIRI_KEY`, `RECON_PROVIDER` | Unused (old photogrammetry) | – |

Generate an admin token: `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`.

---

## 11. How to run, test and deploy

### Run locally
```bash
cd "~/Desktop/right side desktop/3dmodel"
npm install
cp .env.example .env    # fill in keys, or leave empty for free mock mode
npm start               # http://localhost:3000
```
With no keys, everything runs on the **mock** engine (8-second fake generation). For local testing the owner ran with `PHOTO_RETENTION_DAYS=100000 MODEL_RETENTION_DAYS=100000` so test data isn't auto-deleted. To test unlocked options locally use `LOCKED_OPTIONS=none` and `PREVIEW_PROVIDER=mock`.

### Free end-to-end test (no paid generation)
1. Open `/flow3.html?engine=model2&subject=figurine-v3` (or any option), add photos, tick 4 boxes, click Create.
2. Price box → pick a pack, enter an email, Continue → test pay page → "Pay (test)".
3. You land on the result page; the mock model appears after ~8 s; generations left = pack − 1.
4. Try Order a 3D print → size + address → test pay → "Order placed".
5. Owner test without paying: add `?token=<ADMIN_TOKEN>` to the upload page URL.
**Warning:** on the live site, any option whose engine has real keys will spend real vendor credits once a generation starts.

### Deploy (Railway)
Push to `main` → Railway rebuilds the Docker image and redeploys automatically (in-flight jobs are interrupted and become retryable). First-time setup: New Project → Deploy from GitHub repo → add Variables → attach a volume at `/app/data` → region US East → 1 replica → Generate Domain. Custom domain later via Settings → Networking → Custom Domain (CNAME at the registrar). Alternatives: `render.yaml` (Render), or `docker run -p 3000:3000 --env-file .env -v /srv/figurine-data:/app/data figurine-app`.

---

## 12. Rebuilding from zero (if the repo is lost)

1. **First try to recover the code**: GitHub `farazqassemie/3D-figuirne-`; the Railway deployment (its build source); the owner's Mac folder; any Time Machine backup. Customer data lives only on the Railway volume (`/app/data`).
2. If the code is truly gone, rebuild in this order, following sections 3–10 exactly:
   1. `package.json` (ES modules; deps: express 4, multer 1.4.5-lts, sharp 0.33, dotenv 16, @fal-ai/client 1.2) and the Dockerfile/railway.json from §11.
   2. `lib/store.js`: JSON job store (§4.1), `update`, `logEvent`, `timed(stage, provider, fn)` that records timings.
   3. `lib/providers/preview.js`: mock, Rodin (§6.2), Hi3D (§6.3) with never-pay-twice resume logic, engine list and locks.
   4. `lib/pipeline.js`: normalization (§6.4), `runPreview(jobId, photos, { reuseMesh })`, `startFlow3(jobId, paths)`.
   5. `lib/commerce.js`: prices, passes, payments, checkout, `fulfillPayment`, `afterPaymentUrl` (§7).
   6. `lib/retention.js` (§8).
   7. `server.js`: all routes in §5 with the exact check order of `/api/flow3`, the `/files` guard, error handler, `sweepInterrupted()` and `startRetentionSweeper()` at boot.
   8. Front end pages and their behaviour (§1, §7, §8): `style.css` (teal `#0f766e` accent, light grey `#f4f6f5` background, max width 640 px, system font, 10–12 px rounded cards, full-width buttons), `index.html`, `flow3.html`, `checkout.js`, `pay.html`, `review.html` (uses `<model-viewer>` 3.5.0 from unpkg, polls the job every 3 s, gates the order button until the model has loaded), `pass.html`, `admin.html` (table: Job, Status, Engine, Subject, Customer, Print order, Generation time, Created, Photos thumbnails, Model file Download, open; refreshes every 5 s; shows Hi3D balance), `terms.html`, `privacy.html` (§8 contents), `legal.js`.
   9. Guide images: three WebP boards (Model 1: front / left side 90° / right side 90° / back of a person in a blue t-shirt and dark shorts on a grey background, a top-down camera-position diagram at 0°, 90°, 180°, −90° with "same distance ≈ 2.5–3 m, use 2× zoom", and four green-tick tips; Model 2 figurine: equivalent 4-view board; Portrait: head-and-shoulders front example). Recreate with an image generator if lost.
   10. Deploy (§11) and set env vars (§10).

---

## 13. Unused / experimental code (kept on purpose)
- `lib/providers/recon.js` (KIRI Engine photogrammetry, Ultra quality, 8K textures, resume logic) and `lib/frames.js` (ffmpeg video frames, sharpness scoring): from the first plan (video capture → real scan). Not imported anymore.
- `scripts/merge_head_body.py`: Blender headless script that takes a Hi3D **General** body GLB and a Hi3D **Portrait** head GLB, cuts the body's head at 82% height, scales the portrait bust to the body's head width × `--head-scale` (0.72), anchors it by the neck at the collar, joins and exports one GLB, and optionally renders a preview PNG. Run: `blender --background --python scripts/merge_head_body.py -- --body BODY.glb --head HEAD.glb --out MERGED.glb [--png PREVIEW.png]`. It was an experiment for better faces on full figurines; not part of the app.

---

## 14. Open items / to-do (as of 2026-11-21)

**Before a real launch**
1. **Set the 4 legal variables on Railway**: `LEGAL_BUSINESS_NAME`, `LEGAL_CONTACT_EMAIL`, `LEGAL_MAILING_ADDRESS`, `LEGAL_GOVERNING_STATE`, then check `/terms.html` and `/privacy.html` show no yellow placeholders.
2. **Lawyer review**, top issue: Model 2's provider (Hi3D / Hitem3D, Math Magic) appears to be **Hong Kong/China-based**. Under the US DOJ Data Security Program (28 CFR Part 202), sending biometric data of **1,000 or more US persons within 12 months** to a "country of concern" (China incl. Hong Kong) is restricted. Also review: BIPA (Illinois), Texas CUBI, Washington My Health Data Act, CCPA/CPRA and other state laws, vendor-side retention by the AI providers, whether to add arbitration, a registered DMCA agent, and business insurance.
3. **Delete test jobs made before the consent update** (jobs without a `consent` record).
4. **Choose and connect a real payment provider** (§7), and decide sales tax and shipping costs/methods (prices currently include no tax or shipping line).
5. **Email sending** (private link + receipts) with an email service; currently only stored.
6. Update `README.md` and `DEPLOY.md` (they still say payments/consent are out of scope).
7. Rate limiting / abuse protection.

**Product/quality items**
- Verify Hi3D's left/right convention with a swap test (§6.3).
- Keep an eye on Hi3D credit balance (admin page).
- Decide when to unlock Model 1 / Figurine v2.1 (`LOCKED_OPTIONS`).
- Custom domain after the client approves.
- Print production/fulfilment process is manual: the owner sees paid print orders (size + address) on the admin page and downloads the model there.

---

## 15. Things learned (avoid repeating these mistakes)
- iPhone HEIC photos can't be decoded by sharp → reject before any paid call and tell the customer to use JPEG.
- Downscaling photos to 2048 px made results softer than the vendor's own web UI → keep full resolution.
- Hi3D reads multi-view images by position; always send the bit mask, or views get mislabelled.
- Multi-view averaging blurs faces → portraits use a single front photo.
- A CSS rule `.btn { display:block }` overrides the `hidden` attribute → global `[hidden] { display: none !important; }`.
- `<model-viewer>` inserted via innerHTML sometimes never loads → the page re-sets its `src` after it's defined.
- Never resubmit a vendor task when its status check merely failed (would pay twice); only after a confirmed failure.
- Vercel/Netlify/serverless can't host this (long jobs + disk).
