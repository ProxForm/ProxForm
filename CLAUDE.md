# CLAUDE.md — ProxForm

Hey, future Claude. Read this before you touch anything.

## What this is

ProxForm is a **GDPR-proof, browser-only, peer-to-peer medical form portal**. A clinician builds a form in the browser, generates a shareable link + passphrase, and when the patient opens the link they connect directly via WebRTC. The form definition and the patient's answers travel only over that encrypted peer-to-peer data channel.

**There is no server, no database, no PHI at rest.** The GDPR posture is "there is literally nothing to breach." Preserve that invariant.

Built on the same crypto + handshake stack as Btwinus (sibling project at `../btwinus`): PBKDF2 → AES-GCM, encrypted SDP in the URL fragment, two-channel out-of-band signaling (link via one channel, passphrase via another).

## License & ownership

ProxForm is **proprietary software** owned by **Artivicolab**. See `LICENSE` for the full terms. The repo is currently public on GitHub (so GitHub Pages can host it for free) but the license forbids copying, forking-for-derivative-works, or competing products. Every source file carries a one-line copyright signature at the top — preserve it on edits.

Public copy must NOT use the words "open source" or "fork it" — the license switch from AGPL → proprietary happened in commit history; previous wording was scrubbed. Use "auditable in your browser" instead when describing the inspection property.

## How to work on it

There is **no build step**. Vanilla HTML/CSS/JS. Edit a file → commit → GitHub Pages serves it. Same loop as btwinus.

- Cache-bust referenced assets with `?v=N` and bump on change.
- Service worker has its own `CACHE = 'proxform-vN'` — bump when precached assets change.
- Add the `/js/<name>.js?v=N` entry to `sw.js` ASSETS list when introducing a new JS file.
- No new dependencies without discussion.
- All source files (`*.html`, `*.css`, `*.js`, `sw.js`) start with a single-line `© 2026 Artivicolab. All rights reserved. ProxForm — proprietary software. See LICENSE.` header.

## Architecture in 60 seconds

```
/                    → Landing (index.html) — GDPR pitch, FAQ, JSON-LD
/builder.html        → Clinician's form builder + session host (with live preview)
/fill.html           → Patient's form-fill app
/css/style.css       → All styles (light/dark via [data-theme])
/js/crypto.js        → PBKDF2 + AES-GCM + compression + base64 helpers
/js/p2p.js           → WebRTC offer/answer + data channel setup + SAS
/js/builder.js       → Form builder UI + clinician session host + live preview
/js/fill.js          → Patient form rendering + answer submission + draft restore
/js/render.js        → ProxRender: shared intake-form renderer (used by builder preview + fill page)
/js/storage.js       → ProxStore: IndexedDB drafts (builder + fill), persistence + quota check
/js/netcheck.js      → ProxNet: WebRTC connectivity probe (STUN reachability badge)
/js/footer.js        → Contact-email obfuscation (atob-built mailto)
/js/analytics.js     → INERT GA4 loader — fires only if GA_ID is filled. Default off.
/js/theme.js         → Dark/light toggle (localStorage: proxform_theme)
/sw.js               → Service worker (network-first HTML/CSS/JS, cache-first images)
/manifest.json       → PWA manifest
/LICENSE             → Proprietary "all rights reserved" license
/icons/favicon.svg   → Brand mark
```

## The protocol

1. **Clinician builds form** in `builder.html` — adds fields. Field types: `section` (header), `text`, `textarea`, `number`, `date`, `radio`, `checkbox`, `yesno`. Each non-section field has `required` and `column: 'half' | 'full'` flags. Two consecutive `half` fields share a row (intake-form layout).
2. **Generate session** → creates `RTCPeerConnection`, gathers ICE, encrypts the SDP offer with a generated passphrase (PBKDF2 100k iters → AES-256-GCM), produces a link like `https://proxform.com/fill.html#offer=...`.
3. **Out-of-band**: clinician shares the link via one channel (email, WhatsApp), the passphrase via another (SMS, phone). **Two-channel split is the security property** — not the AES itself.
4. **Patient opens link** → enters passphrase → decrypts SDP → builds answer → encrypts answer → sends reply link back.
5. **Clinician pastes reply** → connection completes → data channel opens.
6. **On connect**: clinician sends `{ type: 'form', nonce, form: {...} }` over the channel. Patient renders it.
7. **As patient types**: `{ type: 'answer-update', fieldId, value }` (throttled, 300 ms) for live preview on clinician side. On submit: `{ type: 'submit', answers: {...} }`.
8. **Clinician downloads** the completed form locally (JSON / printable HTML). Nothing is stored on a server. When the tab closes, the data is gone unless they saved it.
9. **Session verification (SAS)**: both sides see a short hex code derived from session nonces — read aloud to defend against MITM during the handshake.

## Local persistence (IndexedDB)

`js/storage.js` exposes `window.ProxStore`. Two object stores in DB `proxform`:

- `builder_drafts` — clinician's in-progress form (key: `'current'`). Restored on page load. Cleared via the **Clear draft** button.
- `fill_drafts` — patient's in-progress answers (key: SHA-256 hash of the encrypted offer, first 8 bytes hex). Restored when the same form arrives over the channel. Cleared automatically on successful submit so PHI doesn't linger.

`ProxStore.checkStorage()` runs on load and toasts a warning if IndexedDB is unavailable or free quota < 5 MB. `requestPersistence()` asks the browser to mark our origin's storage as persistent.

## Connectivity probe

`js/netcheck.js` runs on builder/fill load and renders a topbar badge `#net-status`:

- **✓ P2P ready** — `srflx` candidate gathered, NAT mapping found
- **⚠ Local only** — only `host` candidates, outbound UDP to STUN looks blocked
- **✗ UDP blocked** / **✗ No WebRTC** — hard failure

This is just diagnostic. WebRTC has no fixed inbound port the user can "open."

## Live preview

The builder shows a side-by-side preview pane (`#form-preview`) on screens ≥980px, stacked below on smaller screens. Renders via `ProxRender` (shared with the patient view) so what the clinician sees is byte-for-byte what the patient gets. Inputs in the preview are `disabled`. The **Print / PDF** button toggles `body.printing-preview`, which the print stylesheet uses to hide everything except the preview and lay it out as a clean A4 page.

## Footer (all pages)

Shared footer with: GDPR-proof tagline, anchor links to `/#how`, `/#why`, `/#faq`, a **Contact us** button (email built at click time from two base64 fragments — `artivicolab@gmail.com` never appears in source), and "ProxForm by [Artivicolab](https://artivicolab.com)" attribution.

## GDPR posture

- **No controller-side storage by default** → no Article 30 record-of-processing for transit. The clinician saving a copy to their own device is their responsibility under their own legal basis.
- **No third-party processors** (no Stripe, no Sentry, no analytics enabled). `js/analytics.js` is shipped inert — enabling it would introduce Google as a processor and require a consent banner.
- **Encryption in transit**: WebRTC DTLS 1.3 (browser-default) + AES-256-GCM on the handshake metadata.
- **No cookies**, no tracking. `localStorage` only for theme preference. IndexedDB for clinician drafts and patient answers (cleared on submit) — both stay on the user's own device.

If you're tempted to add an "upload to cloud" or "send to clinician's email" backend, **stop and ask the user**. That changes the legal model entirely (controller/processor relationship, DPA, hosting jurisdiction).

## SEO positioning

The home page (`index.html`) is heavily GDPR-positioned: `<title>` and `<meta description>` lead with "GDPR-Proof Medical Forms — 100% Browser-Only," the hero shows a `gdpr-badge` + "0 servers / 0 PHI / 0 processors / 100% browser" pillar grid, and there are two `<script type="application/ld+json">` blocks (SoftwareApplication + FAQPage) for rich snippets. Don't soften the GDPR copy without checking with the user — it's the headline value prop.

## Monetization (planned, not built)

User wants to charge eventually but no pricing page exists yet. Recommended path when it's time: B2B per-clinic licensing with a static `/pricing` page + Stripe Payment Link (no server). Other options on the table (in CLAUDE conversation history): license-key gate via Cloudflare Worker, per-form credits. Don't build any of this without explicit ask.

## What's NOT done yet (v1 scope)

- **No i18n.** English only. Translation can come later.
- **No form template library.** Clinician builds from scratch each time. Local-storage saved-templates is a natural next step.
- **No native PDF export.** "Print / PDF" relies on the browser's Save-as-PDF print dialog. Could add jsPDF later.
- **No signature field.** Canvas signature is feasible but skipped for v1.
- **No multi-page forms.** Single scrolling form for now.
- **No analytics enabled.** `js/analytics.js` is a placeholder; conflicts with GDPR pitch if turned on.
- **No pricing / paywall.** See "Monetization" above.

## Conventions

- No comments unless the WHY is non-obvious.
- No emojis in code unless they're product UI text.
- Vanilla everything. No frameworks.
- Cache version in every asset URL.
- Absolute paths (`/css/...`, `/js/...`) since pages can live at root or subpaths.
- Every source file has the single-line copyright signature at the top.

## Pointers

- Crypto: `js/crypto.js` — `deriveKey`, `encryptText`, `decryptText`, `compress`, `decompress`, base64 helpers.
- P2P: `js/p2p.js` — `createSession` (offerer), `joinSession` (answerer), `setupChannel`, ICE wait, SAS.
- Form schema: `js/builder.js` `FIELD_TYPES` + `buildFormSnapshot()` — the in-memory form object shape.
- Shared rendering: `js/render.js` `ProxRender.renderIntakeRows(items, cellRenderer)` — pairs half-width fields, emits section bands.
- Drafts: `js/storage.js` `ProxStore.saveBuilderDraft / loadBuilderDraft / clearBuilderDraft / saveFillDraft / loadFillDraft / clearFillDraft`.
- Connectivity: `js/netcheck.js` `ProxNet.checkAndDisplay(elementId)`.

## Repo

Public at `https://github.com/ProxForm/ProxForm`. Branch `main`. No CI, no GitHub Actions. Deploy = push to `main` (GitHub Pages serves it).

When in doubt, mirror the btwinus pattern. Same author, same architectural taste.
