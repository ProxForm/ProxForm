// ProxForm — Google Analytics (GA4) loader.
// Inert until you set GA_ID to your real Measurement ID.
// Note: enabling GA introduces a third-party processor and cookies/identifiers.
// EU traffic likely needs a consent banner; the privacy copy on /index.html
// should be updated to declare Google as a processor.
(function () {
  var GA_ID = 'G-XXXXXXXXXX'; // ← REPLACE with your GA4 Measurement ID

  if (!GA_ID || GA_ID === 'G-XXXXXXXXXX') return;

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', GA_ID, { anonymize_ip: true });
})();
