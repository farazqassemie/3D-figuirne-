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

## Option A — Render (blueprint, easiest)
1. Push this folder to a GitHub repo (`.gitignore` already excludes `.env` and `data/`).
2. Render → **New → Blueprint** → select the repo. It reads `render.yaml`
   (Docker web service + a 10 GB disk at `/app/data`, health check `/api/config`).
3. In the service's **Environment**, fill in the `sync:false` secrets above.
4. Deploy. A persistent disk requires a paid instance type (Starter+).

## Option B — Railway
1. Railway → **New Project → Deploy from GitHub repo** (it auto-detects the `Dockerfile`).
2. **Variables** tab → add the env vars above.
3. **Volumes** → add a volume mounted at `/app/data`.
4. Deploy. Keep it at **1 replica**.

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
