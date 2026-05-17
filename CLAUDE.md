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

## Architecture: the SPA shell

The clinician side is **one single HTML document** — `/app.html`. Every clinician view (Portal / Build / Forms / Import / Submission / Home / GDPR) is a hash route inside that shell. This is the load-bearing invariant: **navigating between clinician views must never reload the page**, otherwise the in-memory `ProxSessions` Map dies and every patient connection dies with it.

```
/                    → Landing (index.html) — GDPR pitch, FAQ, JSON-LD (SEO crawl target)
/app.html            → SPA shell hosting every clinician view via hash routes
/builder.html        → Legacy redirect → /app.html#/build (kept so the SPA can fetch its <main> as a fragment)
/forms.html          → Legacy redirect → /app.html#/forms       "
/received.html       → Legacy redirect → /app.html#/received    "
/import.html         → Legacy redirect → /app.html#/import      "
/fill.html           → Patient's form-fill app (separate document — patient uses their own browser)
/gdpr.html           → GDPR claims page (also reachable inside the SPA at #/gdpr)
/404.html            → Pop-art 404
/css/style.css       → All styles (light/dark via [data-theme])
/js/crypto.js        → PBKDF2 + AES-GCM + compression + base64 + genNonce + computeSessionCode (SAS)
/js/p2p.js           → WebRTC offer/answer + data channel setup
/js/sessions.js      → ProxSessions: multi-session manager + ticket labels + anti-throttle + dormant restore
/js/dashboard.js     → ProxReceivedView: Portal panel (active sessions + submissions list)
/js/builder.js       → ProxBuilderView / ProxFormsView / ProxSubmissionView mount entry points
/js/fill.js          → Patient form rendering + answer submission + draft restore (sessionId-keyed)
/js/render.js        → ProxRender: shared intake-form renderer
/js/storage.js       → ProxStore: IndexedDB stores (forms, submissions, pending_sessions, drafts)
/js/router.js        → ProxRouter: hash router that fetches each route's <main> and calls view.mount()
/js/dialog.js        → ProxConfirm: themed dialog replacing window.confirm()
/js/shield.js        → ProxShield: idle-based privacy shield (mask answers with ***)
/js/netcheck.js      → ProxNet: WebRTC connectivity probe
/js/footer.js        → Contact-email obfuscation (atob-built mailto)
/js/analytics.js     → Consent-gated GA4 (G-WTGX62S0G9). Landing page ONLY, opt-in only. See "Analytics" below.
/js/theme.js         → Dark/light toggle (localStorage: proxform_theme)
/js/templates.js     → 5 industry starter forms surfaced by the "From template…" picker
/js/import.js        → ProxImport: YAML-style + JSON parse / validate / pretty-print + ProxImportView
/js/cond.js          → ProxCond: showIf rule evaluation
/js/sig.js           → ProxSig: canvas signature pad widget
/js/bg.js            → Parallax background (active when body.home-page is set)
/sw.js               → Service worker (network-first HTML/CSS/JS, cache-first images)
/manifest.json       → PWA manifest
/LICENSE             → Proprietary "all rights reserved" license
/icons/favicon.svg   → Brand mark
```

### How the router works

`js/router.js` (`window.ProxRouter`) maps each hash route to a legacy HTML page + a view module export:

```js
received   → /received.html  → ProxReceivedView   (dashboard.js)
build      → /builder.html   → ProxBuilderView    (builder.js)
forms      → /forms.html     → ProxFormsView      (builder.js)
import     → /import.html    → ProxImportView     (import.js)
submission → /builder.html   → ProxSubmissionView (builder.js)
home       → /index.html     → no view (static)
gdpr       → /gdpr.html      → no view (static)
```

On every nav: previous view's `unmount(host)` is called, the route's HTML is fetched (cached in a module-scope `fragmentCache`), `<main>` is extracted via DOMParser, injected into `#view-host`, then the new view's `mount(host, params)` runs. The body gets a per-route class (`builder-page`, `received-page`, `home-page`, etc.) so per-page CSS still applies.

**Legacy pages** still exist and each has a `<script>location.replace('/app.html#/...')</script>` redirect at the top of `<head>`. The redirect fires in browsers (humans landing there get bounced into the SPA) but fetch responses don't execute scripts, so the router's `fetch()` of these pages still reads the full HTML and extracts the fragment.

`fill.html`, `index.html`, `gdpr.html`, and `404.html` are NOT redirected — they need to load standalone:
- `fill.html` is the patient side (different user / device).
- `index.html` and `gdpr.html` are SEO entry points (crawlers and link previews need real HTML there). They have topbar nav that links INTO the SPA at `/app.html#/...`.

### View module contract

Every clinician view exposes:

```js
window.ProxXView = {
  mount(host, params)   // host = <main id="view-host">; params = hash segments after the route name
  unmount(host)         // tear down anything that outlives the cloned DOM (document/window listeners, timers)
};
```

Listeners attached to elements *inside* `host` are GC'd when the router replaces `host.innerHTML`. Listeners on `document` / `window`, ProxSessions event subscriptions, and per-card timers need explicit teardown. Pattern: subscribe to ProxSessions events **once at module load** and have each handler `if (!getElementById('thing-i-touch')) return` so it no-ops when the view isn't mounted — that avoids unsubscribe gymnastics.

## ProxSessions — multi-session manager

`js/sessions.js` (`window.ProxSessions`) owns every clinician-side WebRTC session. State machine:

```
dormant → waiting → connecting → connected → submitted
                          ↓          ↑
                    disconnected ────┘
                          ↓
                        closed
```

- **dormant** — restored from `pending_sessions` IndexedDB store on boot. No `pc`/`dc` yet. Clinician clicks Reopen → mints a fresh portal under the same `sessionId`.
- **waiting** — portal is open, invite link minted, waiting for the patient's reply.
- **connecting** — answer pasted, ICE in progress.
- **connected** — data channel open, form sent, live preview streaming.
- **disconnected** — channel closed / ICE failed. Clinician can Reconnect (fresh `pc`, fresh link, same `sessionId`).
- **submitted** — patient hit submit. Submission record persisted to IndexedDB, in-memory `filesInProgress` wiped. `s.submissionId` stamped so the dashboard's "Open submission" button can jump straight to it.
- **closed** — manually ended. Removed from the Map.

Each record carries its own `pc`, `dc`, `answers`, `filesInProgress`, nonces, SAS, passphrase, inviteUrl, label, formSnapshot, formId, createdAt. **`answers` is held in-memory only** — never persisted across reloads. On submit it's saved as part of the submission record and the live copy is wiped from the session.

### Tab survival

Two layers:

1. **Anti-throttle (`bootAntiThrottle`)** — a silent `AudioContext` started on the first user gesture (one-time global click/keydown listener). Holds the tab as audio-playing so Chrome / Edge don't freeze it when backgrounded. Without this, WebRTC keepalives stall after ~5 min of background.
2. **Dormant restore** — every state change calls `persistRecord(s)` which writes to the `pending_sessions` store. On dashboard mount, `restoreDormant()` reads them back as `dormant` cards. Submitted/closed sessions delete themselves from the store. **What's persisted: sessionId, formSnapshot, formId, senderLabel, state, createdAt**. **NOT persisted: invite URL, passphrase, answers**. The old `pc` is dead anyway — Reopen mints a fresh one; the patient must reopen the new link.

### Ticket labels (DMV scheme)

`nextAutoLabel()` returns `1A, 2A, ..., 200A, 1B, 2B, ..., 200B, 1C, ...` Number cycles 1→200 within each letter; letter advances when the number wraps. Counter lives in `localStorage.proxform_label_counter`. On dashboard mount, `reconcileLabelCounter()` scans `submissions` + `pending_sessions` + in-memory sessions for the highest position already used and bumps the counter past it. Custom labels (typed by the clinician, e.g. "Mrs. Smith") don't match the `^(\d+)([A-Z])$` regex → never burn a ticket position.

Corrections (`sendCorrection`) inherit the original submission's ticket and append `(correction)`. The auto-counter ignores them.

## ProxStore — IndexedDB

`js/storage.js` exposes `window.ProxStore`. DB `proxform`, version 4. Stores:

- `forms` — clinician's saved form templates (id, title, description, fields[], createdAt, updatedAt). Kept across End Shift.
- `builder_drafts` — legacy single-draft store, key `'current'`. Auto-migrated to a real form on first dashboard load via `migrateLegacyDraftIfNeeded()`.
- `fill_drafts` — **patient-side** in-progress answers, keyed by `sessionId`. Restored when the same session arrives over the channel. Cleared on successful submit.
- `submissions` — completed submissions. Sorted **ascending** by `receivedAt` (first-come queue order — hospital staff treat top-of-list as "next up"). Each record: `id, formId, formTitle, formSnapshot, answers, senderLabel, receivedAt`.
- `pending_sessions` — dormant session metadata for tab-survival (see ProxSessions above). NO PHI.

`clearStore(name)` nukes a store in one transaction — used by **End Shift**.

`ProxStore.checkStorage()` runs on boot and toasts a warning if IndexedDB is unavailable or free quota < 5 MB. `requestPersistence()` asks the browser to mark the origin's storage as persistent.

## The wire protocol

1. **Clinician builds form** in `#/build/<formId>`. Field types: `section`, `pagebreak`, `text`, `textarea`, `number`, `date`, `radio`, `checkbox`, `yesno`, `file`, `signature`. Each non-structural field has `required` and `column: 'half' | 'third' | 'quarter' | 'full'`. Consecutive same-width fields share a row.
2. **Generate invite** → `ProxSessions.create({formSnapshot, formId})`. Creates `RTCPeerConnection`, gathers ICE, encrypts SDP offer with a generated passphrase (PBKDF2 100k iters → AES-256-GCM), produces a link like `https://proxform.artivicolab.com/fill.html#offer=...`. Clinician is routed to `#/received` — the new card sits in the Portal.
3. **Out-of-band**: clinician shares link via one channel, passphrase via another. Two-channel split is the security property.
4. **Patient opens link** → enters passphrase → decrypts SDP → builds answer → encrypts answer → sends reply link back.
5. **Clinician pastes reply** in the session card → ICE completes → data channel opens.
6. **On open**: clinician sends `{type:'form', nonce, sessionId, form: {...}}`. Patient stores `sessionId` as its draft key and renders the form.
7. **As patient types**: `{type:'answer-update', fieldId, value}` (throttled 300 ms) for live preview. Files: `file-start` / `file-chunk` / `file-end`.
8. **Reconnect catch-up**: if the patient was mid-fill when the form lands (restored draft), they emit one `{type:'state-sync', answers}` after restore so the clinician's preview catches up. File blobs become `_pendingFile` placeholders until re-uploaded on submit.
9. **Submit**: `{type:'submit', answers: {...}}`. Clinician persists the submission, wipes in-memory answers.
10. **SAS**: short hex code derived from both sides' nonces. Both sides see the same code — clinician reads it aloud to defend against MITM during handshake.

## Privacy shield (data at rest)

Two layers, both replace text with literal `***` (NOT blur — clinician explicitly prefers asterisks).

### Per-card name shield (Portal)

Every submission card on the Portal renders the patient's name through a `.shielded-name` element. CSS `::before { content: '*********' }` paints asterisks by default. On `:hover` OR `.revealed` class, `content: attr(data-real)` swaps in the actual name. The real name is in a `data-real` attribute, never rendered as text until reveal.

- **Hover** = peek without state.
- **👁 Show button** = adds `.revealed` for the duration of the shield preference (auto-relock via `setTimeout`). The Map of unlock timers (`_cardUnlocks`) lives at module scope so re-renders triggered mid-window (new submission arrives) preserve the visible state.

Anonymous submissions (no name field detectable) skip the shield — the ticket label is the hero.

### Idle shield (Submission detail view)

`js/shield.js` (`window.ProxShield`) attaches an idle watcher to the `[data-shield-host]` element on the submission detail page. The clinician picks a timeout from `30 s / 1 min / 2 min / 5 min` (stored in `localStorage.proxform_shield_timeout_ms`). **The shield cannot be turned off — GDPR-proof posture.** Hard-clamped between 30 s and 5 min, both `readPref` and `writePref` enforce this.

The user's chosen value is the **total time from idle → shield engaged**, not the idle-only window. A "Still viewing?" toast appears at `(total − warn)` and counts down for `warn` seconds (= `min(30s, total/2)`). If the clinician clicks "Yes, I'm here" the timer resets; if it expires the shield engages.

When the shield engages: `maskAnswers()` walks every `.intake-answer` in the host AND every `.prox-shield-extra` on the page (so the "From: <name>" header masks in lockstep with the answers), stashes original `innerHTML` on `el._proxOriginal`, replaces with `<span class="prox-mask">***</span>`. An overlay invites a click to reveal. Reveal restores byte-for-byte from `_proxOriginal` and re-arms the idle timer.

## End Shift

`#btn-end-shift` on the Portal. Themed `ProxConfirm` warns explicitly. On accept:
1. Every live `ProxSessions.list()` entry is closed cleanly.
2. `ProxStore.clearStore('submissions')`, `clearStore('pending_sessions')`, `clearStore('fill_drafts')`, `clearStore('builder_drafts')`.
3. `localStorage.removeItem('proxform_label_counter')` → next shift starts at 1A.
4. `forms` (templates) and theme/shield prefs are preserved.

## Themed confirm dialog

Every destructive flow goes through `ProxConfirm(message, { title, confirmText, danger })`. Defined in `js/dialog.js` — themed `<dialog>` with pop-art border + shadow, danger-red confirm button when `danger: true`, focus on Cancel by default so a stray Enter doesn't fire the action. Esc and backdrop click cancel. Native `confirm()` is the fallback only for browsers without `<dialog>` support.

## Sender name extraction

`extractSenderName(formSnapshot, answers)` in `builder.js` sniffs the answers for the patient's name (priority: full legal → full / patient / client / your name → any `name` → first+last fallback). Used by:
- Submission card hero
- Submission detail view "From:" line
- PDF print header

Forms without a name field stay anonymous — we never invent a name from random text fields.

## Patient-side input validation

`js/render.js` `fieldCell` sniffs each `text`-field label and switches the HTML5 input type:
- "email" / "courriel" → `<input type="email">`
- "phone" / "tel" / "mobile" → `<input type="tel" inputmode="tel" pattern="...">`
- "url" / "website" → `<input type="url">`

Explicit `validation.pattern` from the form schema wins over the auto-sniff. `:user-invalid` CSS paints invalid inputs red as the patient types.

## Connectivity probe

`js/netcheck.js` renders a topbar badge `#net-status`:
- **✓ P2P ready** — `srflx` candidate gathered
- **⚠ Local only** — only `host` candidates, outbound UDP to STUN blocked
- **✗ UDP blocked** / **✗ No WebRTC** — hard failure

Diagnostic only.

## Live preview (Build view)

Side-by-side preview pane (`#form-preview`) on screens ≥980px, stacked below on smaller. Renders via `ProxRender` so what the clinician sees is byte-for-byte what the patient gets. Inputs are `disabled`. **Print / PDF** button on the preview AND on the submission detail view uses the SAME paper-renderer (`buildPaperForm(snap, { answers, senderLabel })`) — drops a static HTML version (no real `<input>` elements) into `#print-container` and toggles `body.printing-preview` for the print stylesheet. PDF output is consistent across browsers because there are no native form widgets to render-differ.

## Elapsed time

`fmtElapsed(ts)` returns "just now" → "X min ago" → "X hr ago" → "X d ago" → absolute date past 14 days. A single `setInterval(refreshElapsedNodes, 30000)` at module load walks every `[data-elapsed]` element and updates text. Styled as a loud yellow badge (`.elapsed`) so hospital staff can scan the column at a glance — this was called out as the most important signal for the queue.

## Layout width by view

```
home / gdpr    → home-page CSS — parallax background, narrow reading column
build          → builder-page  — min(96vw, 2400px), editor + preview side-by-side
received       → received-page — min(96vw, 1800px), submissions stack full-width
forms          → forms-page    — min(96vw, 1800px), forms grid
import         → import-page   — narrow column (docs read best single-column)
```

The router toggles these body classes during navigation.

## Footer (all pages)

Shared footer with: GDPR-proof tagline, anchor links to `/#how`, `/#why`, `/#faq`, a **Contact us** button (email built at click time from two base64 fragments — `artivicolab@gmail.com` never appears in source), and "ProxForm by [Artivicolab](https://artivicolab.com)" attribution.

## GDPR posture

- **No controller-side storage by default** → no Article 30 record-of-processing for transit. The clinician saving a copy to their own device is their responsibility under their own legal basis.
- **No third-party processors on the patient/app path** (no Stripe, no Sentry). Analytics is consent-gated GA4 on the **public landing page only** — never on `app.html` or `fill.html`. See "Analytics" below; this scoping is load-bearing for the GDPR/HIPAA claims.
- **Encryption in transit**: WebRTC DTLS 1.3 (browser-default) + AES-256-GCM on the handshake metadata.
- **No cookies**, no tracking. `localStorage` only for theme + shield-interval preference + ticket counter. IndexedDB for clinician templates, submissions, dormant-session metadata, drafts. All on the user's own device.
- **Data at rest on the clinician's device is shielded by default** (asterisks on idle and per-card). End Shift wipes it.

If you're tempted to add an "upload to cloud" or "send to clinician's email" backend, **stop and ask the user**. That changes the legal model entirely (controller/processor relationship, DPA, hosting jurisdiction).

## Domain

Live domain is **`https://proxform.artivicolab.com`** (GitHub Pages + `CNAME` file at repo root). NOT `proxform.com`. All canonical / OG / `sitemap.xml` / `robots.txt` / `llms.txt` URLs use `proxform.artivicolab.com`. If you ever see `proxform.com` in an SEO-facing file it's a regression — it must match the live host or indexing breaks.

## Analytics

**`js/analytics.js` is consent-gated Google Analytics 4 (`G-WTGX62S0G9`), landing page only.** Rules, in order of importance:

1. **GA only loads on the public landing page** (`/` or `/index.html` with `body.home-page`). `isLandingHome()` enforces this. It is a hard no-op on `app.html`, `fill.html`, `gdpr.html`, `hipaa.html` — the PHI path stays analytics-free.
2. **GA does not load until the visitor clicks "Accept"** on the consent banner (`showBanner()`). Decline writes `localStorage.proxform_ga_consent = 'denied'` and GA never loads. Accept → `'granted'` → `loadGA()` injects gtag (anonymized IP, ad signals off).
3. **GA4's "Data collection isn't active" warning is EXPECTED and will likely never clear.** Google's setup detector loads the page headlessly and cannot click the consent banner, so it never sees the tag. This is not a bug. Verify by real Realtime hits after manually clicking Accept on the live site — not by the GA4 setup banner.
4. **DO NOT "fix" the warning by pasting Google's raw `gtag` snippet into `<head>`** (what GA4's own instructions say). That fires GA on every page including the patient/PHI path with no consent and detonates the entire GDPR/HIPAA story. The persistent warning is the correct price of privacy-clean analytics.
5. The GDPR/HIPAA/FAQ copy is already scoped to say "the app and patient path collect nothing; the public landing page uses consent-gated Google Analytics." Keep that distinction if you touch the copy.

## SEO / AI-SEO

`index.html` is the SEO entry point — title/description lead with "GDPR-Proof Medical Forms — 100% Browser-Only." Structured data in place:

- `index.html`: JSON-LD for **Organization** (Artivicolab), **WebSite**, **SoftwareApplication**, **FAQPage**.
- `gdpr.html` / `hipaa.html`: **TechArticle** JSON-LD (author/publisher = Artivicolab).
- All 3 marketing pages: `og:image` + Twitter cards (currently `→ /icons/logo-lockup.png`; a dedicated 1200×630 `/icons/og-card.png` is the planned upgrade — repoint `og:image`/`twitter:image` on all 3 + bump cache when it lands), `robots` meta `max-image-preview:large, max-snippet:-1`, `author` meta.
- **`/llms.txt`** (llmstxt.org convention) — concise factual brief so AI assistants answer accurately ("not a cloud SaaS, no servers, owned by Artivicolab"). Keep it current if the product story changes.
- **`robots.txt`** explicitly welcomes AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, etc.) on the marketing pages while disallowing the app/PHI pages for everyone.

The landing page is also reachable inside the SPA at `#/home` (router fetches `index.html`'s `<main>`). Don't soften the GDPR copy without checking with the user — it's the headline value prop.

## Monetization (planned, not built)

User wants to charge eventually but no pricing page exists yet. Recommended path: B2B per-clinic licensing with a static `/pricing` page + Stripe Payment Link (no server). Other options discussed: license-key gate via Cloudflare Worker, per-form credits. Don't build any of this without explicit ask.

## What's NOT done yet

- **No i18n.** English only. (French phone/courriel patterns landed for input sniffing, but UI strings aren't translated.)
- **No native PDF export.** Print → Save as PDF is the path. jsPDF could come later.
- **No pricing / paywall.**
- **No YAML round-trip for `showIf`.** JSON only.
- **Single file per `file` field.** No multi-file.

## Conventions

- No comments unless the WHY is non-obvious.
- No emojis in code unless they're product UI text.
- Vanilla everything. No frameworks.
- Cache version in every asset URL.
- Absolute paths (`/css/...`, `/js/...`) since pages live at root.
- Every source file has the single-line copyright signature at the top.
- Destructive flows go through `ProxConfirm`, not `window.confirm`.
- Patient-facing UI elements that show PHI on the clinician device need shielding (`.shielded-name` for inline name displays, `.prox-shield-extra` for extras outside the shield's container).
- **Never put the contact email address in source.** `artivicolab@gmail.com` must never appear literally in any HTML/JS/CSS/text file (it gets harvested by scrapers). The only place the address exists is the two base64 fragments in `js/footer.js`, rebuilt into a `mailto:` at click time. Any "contact us" affordance — footer or inline in prose — uses `id="contact-btn"` or `class="contact-link"` (a `<button class="link-btn contact-link">contact us</button>`); `footer.js` binds both to the same build-at-click handler. Don't hardcode a `mailto:`, don't write the address in a privacy/legal page, don't add it to JSON-LD/schema. If you need a new contact entry point, give it `.contact-link`, not the literal email.

## Pointers

- Crypto: `js/crypto.js` — `deriveKey`, `encryptText`, `decryptText`, `compress`, `decompress`, `genNonce`, `computeSessionCode`.
- P2P: `js/p2p.js` — `createSession` (offerer), `joinSession` (answerer), `completeSession`, ICE wait.
- Sessions: `js/sessions.js` `ProxSessions.create / connect / reconnect / reopenDormant / restoreDormant / sendCorrection / end / reconcileLabelCounter`.
- Form schema: `js/builder.js` `FIELD_TYPES` + `buildFormSnapshot()`.
- Shared rendering: `js/render.js` `ProxRender.renderIntakeRows(items, cellRenderer)`.
- Submission paper-print: `js/builder.js` `buildPaperForm(snap, { answers, senderLabel })`.
- Storage: `js/storage.js` `ProxStore.*` — see "ProxStore" section above.
- Router: `js/router.js` `ProxRouter.go(route, ...params)`, `current()`, `invalidate(routeName)`.
- Confirm: `js/dialog.js` `ProxConfirm(message, opts)`.
- Shield: `js/shield.js` `ProxShield.attach(container)`, `buildPicker(targetEl)`, `readPref`, `writePref`.
- Sender name: `js/builder.js` `extractSenderName(formSnapshot, answers)`.

## Repo

Public at `https://github.com/ProxForm/ProxForm`. Branch `main`. No CI, no GitHub Actions. Deploy = push to `main` (GitHub Pages serves it).

When in doubt, mirror the btwinus pattern. Same author, same architectural taste.
