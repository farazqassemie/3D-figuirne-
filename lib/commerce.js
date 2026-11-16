import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getJob, update } from './store.js';

// ---------------------------------------------------------------------------
// Prices — the ONLY place they are set. Amounts are in US cents.
// ---------------------------------------------------------------------------
export const PACKS = [
  { id: 'pack1', generations: 1, cents: 299, label: '1 generation' },
  { id: 'pack2', generations: 2, cents: 499, label: '2 generations' },
  { id: 'pack3', generations: 3, cents: 699, label: '3 generations', note: 'Try different outfits or different people' },
];

export const PRINT_SIZES = [
  { id: 'cm5', label: '5 cm', cents: 5000 },
  { id: 'cm10', label: '10 cm', cents: 8000 },
  { id: 'cm15', label: '15 cm', cents: 12000 },
];

export function pricing() {
  return { currency: 'USD', packs: PACKS, printSizes: PRINT_SIZES, provider: paymentProvider() };
}

// Which payment provider takes the money. Only 'test' exists until the owner
// picks a real one (Stripe, Square, PayPal, …); that provider's hosted checkout
// will plug into createCheckout() + a webhook that calls fulfillPayment().
// Card/bank details are NEVER entered on our own pages.
export function paymentProvider() {
  return (process.env.PAYMENTS_PROVIDER || 'test').toLowerCase();
}

// ---------------------------------------------------------------------------
// Tiny JSON stores (same pattern as jobs)
// ---------------------------------------------------------------------------
const DATA = path.resolve('data');
function store(name) {
  const dir = path.join(DATA, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = (id) => path.join(dir, `${id}.json`);
  return {
    get(id) {
      if (!/^[a-f0-9]{12}$/.test(String(id))) return null;
      try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch { return null; }
    },
    save(obj) {
      fs.writeFileSync(file(obj.id) + '.tmp', JSON.stringify(obj, null, 2));
      fs.renameSync(file(obj.id) + '.tmp', file(obj.id));
      return obj;
    },
    list() {
      return fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
        .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } })
        .filter(Boolean);
    },
  };
}
const passes = store('passes');
const payments = store('payments');
const newId = () => crypto.randomBytes(6).toString('hex');
const newToken = () => crypto.randomBytes(16).toString('hex');
const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Passes = a customer's paid generations. Reached by a private link
// (pass id + token), no password. The email is where the link is sent.
// ---------------------------------------------------------------------------
export function getPass(id) { return passes.get(id); }
export function ownsPass(pass, token) { return !!pass && !!token && pass.token === token; }
export function remaining(pass) { return pass ? Math.max(0, pass.credits - pass.used) : 0; }

// Use one generation. Returns false when none are left. Node runs this
// synchronously, so two requests can't both take the last credit.
export function useCredit(passId, jobId, why) {
  const pass = passes.get(passId);
  if (!pass || remaining(pass) < 1) return false;
  pass.used += 1;
  pass.history.push({ at: now(), jobId, change: -1, why });
  if (!pass.jobs.includes(jobId)) pass.jobs.push(jobId);
  passes.save(pass);
  return true;
}

// Give a generation back (e.g. the upload was rejected after it was charged).
export function refundCredit(passId, jobId, why) {
  const pass = passes.get(passId);
  if (!pass) return;
  pass.used = Math.max(0, pass.used - 1);
  pass.history.push({ at: now(), jobId, change: +1, why });
  passes.save(pass);
}

export function publicPass(pass) {
  return {
    id: pass.id,
    email: pass.email,
    credits: pass.credits,
    used: pass.used,
    remaining: remaining(pass),
    paid: pass.paid,
    jobs: pass.jobs.map((id) => getJob(id)).filter(Boolean).map((j) => ({
      id: j.id, token: j.token, status: j.status, engine: j.engine, subject: j.subject,
      createdAt: j.createdAt, printOrder: j.printOrder ? { size: j.printOrder.size, status: j.printOrder.status } : null,
    })),
  };
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,185}\.[^\s@]{2,}$/;
export function validEmail(e) { return typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e.trim()); }

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------
// Buying a generation pack. An existing pass can be topped up.
export function startPackCheckout({ packId, email, engine, subject, topUpPassId, topUpToken }) {
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) throw httpError(400, 'Please choose a pack.');
  let pass = topUpPassId ? passes.get(topUpPassId) : null;
  if (topUpPassId && !ownsPass(pass, topUpToken)) throw httpError(403, 'Forbidden');
  if (!pass) {
    if (!validEmail(email)) throw httpError(400, 'Please enter a valid email address.');
    pass = passes.save({
      id: newId(), token: newToken(), email: email.trim().toLowerCase(),
      credits: 0, used: 0, paid: false, jobs: [], history: [], createdAt: now(),
    });
  }
  const payment = payments.save({
    id: newId(), token: newToken(), kind: 'pack', status: 'pending', provider: paymentProvider(),
    cents: pack.cents, currency: 'USD', description: `${pack.label} (3D model generation)`,
    passId: pass.id, packId: pack.id, generations: pack.generations,
    // where to send the customer after paying
    next: { engine: engine || null, subject: subject || null },
    createdAt: now(),
  });
  return { payment, pass };
}

// Ordering a 3D print of a finished model.
export function startPrintCheckout(job, { sizeId, shipping }) {
  const size = PRINT_SIZES.find((s) => s.id === sizeId);
  if (!size) throw httpError(400, 'Please choose a size.');
  if (!['preview_ready', 'done'].includes(job.status) || !job.files?.preview) {
    throw httpError(409, 'This model is not ready to print.');
  }
  if (job.printOrder?.status === 'paid') throw httpError(409, 'This model has already been ordered.');
  const ship = cleanShipping(shipping);
  const payment = payments.save({
    id: newId(), token: newToken(), kind: 'print', status: 'pending', provider: paymentProvider(),
    cents: size.cents, currency: 'USD', description: `3D printed figurine, ${size.label}`,
    jobId: job.id, sizeId: size.id, createdAt: now(),
  });
  update(job.id, { printOrder: { size: size.label, sizeId: size.id, cents: size.cents, shipping: ship, status: 'awaiting_payment', paymentId: payment.id, createdAt: now() } });
  return { payment };
}

// US shipping only for now. Every field is trimmed and length-capped.
function cleanShipping(s = {}) {
  const f = (k, max = 100) => String(s[k] || '').trim().slice(0, max);
  const out = { name: f('name'), line1: f('line1'), line2: f('line2'), city: f('city', 60), state: f('state', 2).toUpperCase(), zip: f('zip', 10), phone: f('phone', 25) };
  if (!out.name || !out.line1 || !out.city || !/^[A-Z]{2}$/.test(out.state) || !/^\d{5}(-\d{4})?$/.test(out.zip)) {
    throw httpError(400, 'Please fill in your full US shipping address (name, street, city, 2-letter state, ZIP).');
  }
  return out;
}

export function getPayment(id) { return payments.get(id); }

export function publicPayment(p) {
  return { id: p.id, kind: p.kind, status: p.status, cents: p.cents, currency: p.currency, description: p.description, provider: p.provider };
}

// Called exactly once when the provider confirms the money arrived (test
// mode: the test pay button; real provider: its webhook). Idempotent.
export function fulfillPayment(id, providerRef) {
  const p = payments.get(id);
  if (!p) throw httpError(404, 'Payment not found');
  if (p.status === 'paid') return p;
  p.status = 'paid';
  p.paidAt = now();
  p.providerRef = providerRef || null;
  payments.save(p);
  if (p.kind === 'pack') {
    const pass = passes.get(p.passId);
    pass.credits += p.generations;
    pass.paid = true;
    pass.history.push({ at: now(), change: +p.generations, why: `bought ${p.packId}`, paymentId: p.id });
    passes.save(pass);
  } else if (p.kind === 'print') {
    const job = getJob(p.jobId);
    update(p.jobId, {
      status: 'done',
      approvedAt: now(),
      printOrder: { ...job.printOrder, status: 'paid', paidAt: now() },
    });
  }
  return p;
}

// Where the customer lands after paying.
export function afterPaymentUrl(p) {
  if (p.kind === 'pack') {
    const pass = passes.get(p.passId);
    const q = new URLSearchParams({ pass: pass.id, pt: pass.token });
    if (p.next?.engine) q.set('engine', p.next.engine);
    if (p.next?.subject) q.set('subject', p.next.subject);
    return (p.next?.engine ? 'flow3.html?' : 'pass.html?') + q;
  }
  const job = getJob(p.jobId);
  return `review.html?job=${job.id}&t=${job.token}`;
}

export function listPayments() { return payments.list(); }

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
