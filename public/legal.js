// Shared by every page: adds the legal footer links, and on the legal pages
// fills in the business details from /api/legal (set as env vars on the host).
// An unset detail shows a highlighted placeholder so it's obvious before launch.
(function () {
  const footer = document.createElement('p');
  footer.className = 'legal-footer';
  footer.innerHTML =
    '<a href="terms.html">Terms of Service</a> · ' +
    '<a href="privacy.html">Privacy Policy</a> · ' +
    '<a href="privacy.html#biometric">Biometric Data Notice</a> · ' +
    '<a href="privacy.html#your-rights">Your Privacy Choices</a>';
  document.body.appendChild(footer);

  const slots = document.querySelectorAll('[data-legal]');
  if (!slots.length) return;
  const PLACEHOLDER = {
    businessName: 'BUSINESS NAME (set LEGAL_BUSINESS_NAME)',
    contactEmail: 'CONTACT EMAIL (set LEGAL_CONTACT_EMAIL)',
    mailingAddress: 'MAILING ADDRESS (set LEGAL_MAILING_ADDRESS)',
    governingState: 'STATE (set LEGAL_GOVERNING_STATE)',
  };
  fetch('/api/legal').then((r) => r.json()).then((d) => {
    slots.forEach((el) => {
      const key = el.dataset.legal;
      const value = key === 'photoDays' ? d.retention && d.retention.photos
        : key === 'modelDays' ? d.retention && d.retention.models
        : d[key];
      if (value || value === 0) {
        if (key === 'contactEmail') {
          const a = document.createElement('a');
          a.href = 'mailto:' + value;
          a.textContent = value;
          el.replaceChildren(a);
        } else {
          el.textContent = value;
        }
      } else {
        el.textContent = PLACEHOLDER[key] || '—';
        el.classList.add('legal-missing');
      }
    });
  }).catch(() => {});
})();
