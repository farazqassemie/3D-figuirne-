# Deploying the figurine app

This is a **stateful, long-running-job Node server** — jobs, uploaded photos, and
generated meshes live on local disk in `data/`, and each Hi3D generation polls
in-process for up to an hour. So it needs a **persistent host** (Railway / Render
/ Fly / a VPS), a **persistent volume** mounted at `/app/data`, and it must run as
a **single instance** (do not enable autoscaling / multiple replicas — the disk
and the in-flight jobs are per-instance).

> It will NOT work on Vercel/Netlify/Lambda: those have a read-only/ephemeral
> filesystem and kill functions after seconds, so every job would vanish and no
> generation would ever finish.

## Environment variables (set these on the host — never commit `.env`)

| Var | What | Required |
|---|---|---|
| `HI3D_CLIENT_ID` / `HI3D_CLIENT_SECRET` | Hi3D (Model 2), from platform.hi3d.ai/console/apiKey | for Model 2 |
| `FAL_KEY` | Rodin (Model 1), from fal.ai | for Model 1 |
| `ADMIN_TOKEN` | gates `/admin.html` + `/api/jobs`; open the dashboard at `/admin.html?token=<this>` | yes (or admin is locked) |
| `PORT` | provided by the host automatically | auto |
| `HI3D_*` quality knobs | optional; defaults are already maximum quality | no |

Copy the names from `.env.example`. Generate an `ADMIN_TOKEN` with e.g.
`node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`.

## Option A — Railway (chosen host)
Customers are in the US, so use a **US East** region (close to customers and to fal.ai).
`railway.json` already sets: Dockerfile build, 1 replica, health check `/api/config`,
restart on failure. The volume and region can't be set in that file, so do them in the dashboard.

1. Railway → **New Project → Deploy from GitHub repo** → select this repo
   (branch `main`). It builds from the `Dockerfile` using `railway.json`.
2. **Variables** tab → add `FAL_KEY`, `HI3D_CLIENT_ID`, `HI3D_CLIENT_SECRET`,
   `ADMIN_TOKEN`, plus any `RODIN_*` / `HI3D_*` overrides you use locally.
   Do not set `PORT` — Railway provides it.
3. Right-click the service → **Attach volume** → mount path **`/app/data`**
   (start with 5–10 GB; it can grow later).
4. **Settings → Region** → a US East region. Keep it at **1 replica**
   (the disk and in-flight jobs are per-instance).
5. **Settings → Networking → Generate Domain** to get a `*.up.railway.app` URL
   and check the app loads.
6. Custom domain: **Settings → Networking → Custom Domain** → enter your domain →
   add the CNAME (and TXT verification, if shown) record Railway gives you at
   your domain registrar's DNS settings. HTTPS is issued automatically.

Note: every push to `main` redeploys. With a volume attached, Railway stops the
old instance before starting the new one, so a redeploy interrupts in-flight jobs
(they become retryable — see "After it's live").

## Option B — Render (blueprint)
1. Render → **New → Blueprint** → select the repo. It reads `render.yaml`
   (Docker web service + a 10 GB disk at `/app/data`, health check `/api/config`).
2. In the service's **Environment**, fill in the `sync:false` secrets above.
3. Deploy. A persistent disk requires a paid instance type (Starter+). Starter has
   only 512 MB of memory, which is tight for 100 MB+ model files.

## Option C — any Docker host / VPS
```
docker build -t figurine-app .
docker run -d -p 3000:3000 --env-file .env -v /srv/figurine-data:/app/data figurine-app
```

## After it's live
- Customer app: `https://<your-host>/`
- Admin dashboard: `https://<your-host>/admin.html?token=<ADMIN_TOKEN>`
- **Access control:** every job now issues an unguessable per-job token. A
  customer's review link is `/review.html?job=<id>&t=<token>` and their photos/
  model at `/files/uploads/<id>/…?t=<token>` are only served with that token (or
  the admin token). Without it, `/files` and `/api/jobs/:id` return 403 — so no
  one can browse another customer's face photos.
- On restart/redeploy, in-flight jobs are moved to a retryable state and resume
  the paid Hi3D task on "Try again" (no double charge).

## Still deliberately out of scope (MVP)
Payments, accounts/login, email, HTTPS termination (the host provides it), rate
limiting, and multi-instance scaling. Add these before a real public launch.
