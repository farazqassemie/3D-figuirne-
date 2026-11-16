// Shared pricing box (generation packs) + remembering the customer's pass.
// openPackBox({ engine, subject, pass, pt }) shows the packs; picking one and
// continuing creates a checkout and sends the browser to the payment page.
(function () {
  const money = (c) => '$' + (c / 100).toFixed(2);

  // The pass link is the customer's key to their generations. Remember it in
  // this browser for convenience (the private link also works on any device).
  const KEY = 'figurinePass';
  window.savedPass = function () {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
  };
  window.rememberPass = function (pass, pt) {
    try { localStorage.setItem(KEY, JSON.stringify({ pass, pt })); } catch {}
  };
  window.passLink = function (pass, pt) {
    return location.origin + '/pass.html?pass=' + encodeURIComponent(pass) + '&pt=' + encodeURIComponent(pt);
  };

  const css = document.createElement('style');
  css.textContent = `
    .pk-back { position: fixed; inset: 0; background: rgba(15, 30, 27, .45); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 50; }
    .pk-box { background: #fff; border-radius: 14px; width: 100%; max-width: 420px; padding: 18px; max-height: 92vh; overflow: auto; }
    .pk-box h2 { margin: 0 0 4px; }
    .pk-opt { display: flex; align-items: center; gap: 10px; border: 1.5px solid #dde4e2; border-radius: 10px; padding: 10px 12px; margin: 8px 0; cursor: pointer; }
    .pk-opt input { accent-color: #0f766e; width: 17px; height: 17px; }
    .pk-opt:has(input:checked) { border-color: #0f766e; background: #f0f8f6; }
    .pk-opt .pk-name { font-weight: 600; }
    .pk-opt .pk-note { display: block; font-size: 12.5px; color: #5d6e6a; }
    .pk-opt .pk-price { margin-left: auto; font-weight: 700; font-size: 17px; }
    .pk-box input[type=email] { width: 100%; padding: 11px; font-size: 16px; border: 1.5px solid #c8d2cf; border-radius: 9px; margin-top: 4px; }
    .pk-box .pk-x { float: right; background: none; border: none; font-size: 22px; line-height: 1; cursor: pointer; color: #5d6e6a; }
  `;
  document.head.appendChild(css);

  window.openPackBox = async function ({ engine, subject, pass, pt } = {}) {
    let pricing;
    try { pricing = await fetch('/api/pricing').then((r) => r.json()); } catch { alert('Network problem — please try again.'); return; }
    const back = document.createElement('div');
    back.className = 'pk-back';
    const topUp = !!(pass && pt);
    back.innerHTML =
      '<div class="pk-box" role="dialog" aria-modal="true" aria-labelledby="pkTitle">' +
      '<button class="pk-x" aria-label="Close">×</button>' +
      '<h2 id="pkTitle">' + (topUp ? 'Buy more generations' : 'Choose your generations') + '</h2>' +
      '<p class="muted">Each generation makes one 3D model from your photos. Regenerating uses one generation. Downloading your 3D file is included.</p>' +
      pricing.packs.map((p, i) =>
        '<label class="pk-opt"><input type="radio" name="pk" value="' + p.id + '"' + (i === 0 ? ' checked' : '') + '>' +
        '<span><span class="pk-name">' + p.label + '</span>' + (p.note ? '<span class="pk-note">' + p.note + '</span>' : '') + '</span>' +
        '<span class="pk-price">' + money(p.cents) + '</span></label>'
      ).join('') +
      (topUp ? '' :
        '<label style="display:block;margin-top:12px;font-size:14px">Email <span class="muted">(we send your private link and receipt here)</span>' +
        '<input type="email" id="pkEmail" autocomplete="email" required></label>') +
      '<button class="btn" id="pkGo">Continue to payment</button>' +
      '<p class="muted" style="font-size:12px;text-align:center">Prices in USD. By continuing you agree to the <a href="terms.html" target="_blank">Terms</a> and <a href="privacy.html" target="_blank">Privacy Policy</a>.</p>' +
      '<div id="pkErr"></div></div>';
    document.body.appendChild(back);
    const close = () => back.remove();
    back.querySelector('.pk-x').onclick = close;
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    back.querySelector('#pkGo').onclick = async (e) => {
      const btn = e.currentTarget;
      const body = { pack: back.querySelector('input[name=pk]:checked').value, engine, subject };
      if (topUp) { body.pass = pass; body.pt = pt; } else { body.email = back.querySelector('#pkEmail').value; }
      btn.disabled = true;
      try {
        const res = await fetch('/api/checkout/pack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Something went wrong (' + res.status + ')');
        location.href = data.payUrl;
      } catch (err) {
        back.querySelector('#pkErr').innerHTML = '<div class="error">' + String(err.message).replace(/</g, '&lt;') + '</div>';
        btn.disabled = false;
      }
    };
  };
})();
