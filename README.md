# ProxForm

GDPR-proof, browser-only, peer-to-peer medical form portal.

Clinician builds a form in the browser, shares a link + passphrase with the patient through two separate channels. Patient fills the form, answers go directly browser-to-browser over an encrypted WebRTC data channel. **No server, no database, no PHI at rest.**

## How it works

1. Open `builder.html`. Add the fields you want.
2. Click **Generate link**. You get a link + a passphrase.
3. Send the link via one channel (email). Send the passphrase via another (SMS, phone).
4. The patient opens the link, enters the passphrase, and fills the form.
5. You receive their answers live in your browser. Save locally — nothing is stored anywhere else.

## Stack

Vanilla HTML / CSS / JS. No build step. Hosted on GitHub Pages.

Crypto: PBKDF2 (100k iters, SHA-256) → AES-256-GCM on the WebRTC handshake metadata. DTLS 1.3 (browser-default) on the data channel itself.

## Development

```
open index.html
```

That's it.

## License

ProxForm is **proprietary software**. Copyright © 2026 Artivicolab. All rights reserved. See [LICENSE](LICENSE) for the full terms.

In short: source files are visible to your browser (that's how the web works), but you may not copy, fork, redistribute, or build derivative or competing products from them without written permission.

ProxForm is a product of [Artivicolab](https://artivicolab.com).
