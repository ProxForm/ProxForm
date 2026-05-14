# CLAUDE.md — ProxForm

Hey, future Claude. Read this before you touch anything.

## What this is

ProxForm is a **GDPR-proof, browser-only, peer-to-peer medical form portal**. A clinician builds a form in the browser, generates a shareable link + passphrase, and when the patient opens the link they connect directly via WebRTC. The form definition and the patient's answers travel only over that encrypted peer-to-peer data channel.

**There is no server, no database, no PHI at rest.** The GDPR posture is "there is literally nothing to breach." Preserve that invariant.

Built on the same crypto + handshake stack as Btwinus (sibling project at `../btwinus`): PBKDF2 → AES-GCM, encrypted SDP in the URL fragment, two-channel out-of-band signaling (link via one channel, passphrase via another).

## How to work on it

There is **no build step**. Vanilla HTML/CSS/JS. Edit a file → commit → GitHub Pages serves it. Same loop as btwinus.

- Cache-bust referenced assets with `?v=N` and bump on change.
- Service worker has its own `CACHE = 'proxform-vN'` — bump when precached assets change.
- No new dependencies without discussion.

## Architecture in 60 seconds

```
/                    → Landing (index.html) — what is proxform, GDPR pitch
/builder.html        → Clinician's form builder + session host
/fill.html           → Patient's form-fill app
/css/style.css       → All styles
/js/crypto.js        → PBKDF2 + AES-GCM + compression + base64 helpers
/js/p2p.js           → WebRTC offer/answer + data channel setup
/js/builder.js       → Form builder UI + clinician session host
/js/fill.js          → Patient form rendering + answer submission
/js/home.js          → Landing page interactions
/js/theme.js         → Dark/light toggle
/sw.js               → Service worker (network-first HTML/CSS/JS)
/manifest.json       → PWA manifest
```

## The protocol

1. **Clinician builds form** in `builder.html` — adds fields (text, textarea, number, date, radio, checkbox, yes/no), sets required flags.
2. **Generate session** → creates RTCPeerConnection, gathers ICE, encrypts the SDP offer with a generated passphrase (PBKDF2 100k iters → AES-256-GCM), produces a link like `https://proxform.com/fill.html#offer=...`.
3. **Out-of-band**: clinician shares the link via one channel (email, WhatsApp), the passphrase via another (SMS, phone). **Two-channel split is the security property** — not the AES itself.
4. **Patient opens link** → enters passphrase → decrypts SDP → builds answer → encrypts answer → sends reply link back.
5. **Clinician pastes reply** → connection completes → data channel opens.
6. **On connect**: clinician sends `{ type: 'form', form: {...} }` over the channel. Patient renders it.
7. **As patient types** (optional): `{ type: 'answer-update', fieldId, value }` for live preview on clinician side. On submit: `{ type: 'submit', answers: {...} }`.
8. **Clinician downloads** the completed form locally (JSON / printable HTML). Nothing is stored on a server. When the tab closes, the data is gone unless they saved it.
9. **Session verification (SAS)**: both sides see a short hex code derived from session nonces — read aloud to defend against MITM during the handshake.

## GDPR posture

- **No controller-side storage by default** → no Article 30 record-of-processing for transit. The clinician saving a copy to their own device is their responsibility under their own legal basis.
- **No third-party processors** (no Stripe, no Sentry, no analytics by default — if we add any, document them here and in a privacy page).
- **Encryption in transit**: WebRTC DTLS 1.3 (browser-default) + our AES-GCM on the handshake metadata.
- **No cookies**, no tracking. `localStorage` only used for theme preference and (optionally) clinician's saved form templates on their own device.

If you're tempted to add an "upload to cloud" or "send to clinician's email" backend, **stop and ask the user**. That changes the legal model entirely (controller/processor relationship, DPA, hosting jurisdiction).

## What's NOT done yet (v1 scope)

- **No i18n.** English only. Translation can come later, same posture as btwinus's chat.html.
- **No form template library.** Clinician builds from scratch each time. Local-storage saved-templates is a natural next step.
- **No PDF export.** Submitted forms download as JSON; clinician can print the rendered HTML view. WeasyPrint/jsPDF could come later.
- **No signature field.** Canvas signature is feasible but skipped for v1.
- **No multi-page forms.** Single scrolling form for now.
- **No blog / SEO landing copy depth.** Lift the btwinus pattern when we want organic traffic.

## Conventions

- No comments unless the WHY is non-obvious.
- No emojis in code unless they're product UI text.
- Vanilla everything. No frameworks.
- Cache version in every asset URL.
- Absolute paths (`/css/...`, `/js/...`) since pages can live at root or subpaths.

## Pointers

- Crypto: `js/crypto.js` — `deriveKey`, `encryptText`, `decryptText`, `compress`, `decompress`, base64 helpers.
- P2P: `js/p2p.js` — `createSession` (offerer), `joinSession` (answerer), `setupChannel`, ICE wait, SAS.
- Form schema: see `js/builder.js` — the in-memory form object shape.

When in doubt, mirror the btwinus pattern. Same author, same architectural taste.
