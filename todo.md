# ProxForm — Builder TODO

All initial items completed. Kept as a record of what shipped.

## Quick wins

1. ✅ **Duplicate field** — clone button on each row, scrolls + focuses the clone.
2. ✅ **Help text per field** — optional one-liner under each question; `> text` in YAML.
3. ✅ **Section description** — optional subtitle on section bands; same `> text` syntax.
4. ✅ **Saving… / Saved indicator** — pill near the title with bouncing-dots while saving and a shield-shine sweep when saved.
5. ✅ **Default value per field** — pre-fills the patient view; `= value` in YAML, repeat lines for checkbox.
6. ✅ **Test-fill mode** — toggle the preview to interactive so the clinician can rehearse without transmitting.

## Mid-effort

7. ✅ **Form templates** — 5 industry starters (medical, legal, hospitality, HR, wellness) via the *From template…* picker on the forms list.
8. ✅ **Drag-and-drop reorder** — handle on each row, locked by default to prevent accidents, Esc cancels a drag.
9. ✅ **Field validation rules** — `min`/`max` (number), `minlen`/`maxlen` (text/textarea), `pattern` (text). Live `:user-invalid` styling.
10. ✅ **Undo / redo** — structural ops only; `⌘Z` / `⇧⌘Z` keyboard shortcuts + toolbar buttons.
11. ✅ **Form search / filter** — live filter the editor by label/type, count pill, Esc clears.
12. ✅ **Question numbering toggle** — form-level flag; auto-numbers visible questions, skips sections.
13. ✅ **Third / Quarter columns** — generalised the half/full pairing; same-width fields pack into rows.

## Big features

14. ✅ **Conditional logic** — `showIf` rule per field (equals/notEquals/contains/notContains/empty/notEmpty). Live re-evaluation in patient view + test-fill. Hidden required fields skipped on submit. JSON round-trip; YAML deferred.
15. ✅ **Multi-page forms** — `pagebreak` field type; patient view shows Prev/Next with per-page required validation; clinician sees the whole submission flat.
16. ✅ **File / photo upload** — `file` field type with `accept` (image/PDF/any). 5 MB cap. Chunked transfer over the existing WebRTC data channel — no backend, GDPR posture preserved.
17. ✅ **Signature field** — canvas pad (mouse / finger / stylus) → base64 PNG; rides the file chunk transport. Shared `ProxSig` widget used by both the patient view and the builder's test-fill.
18. ✅ **Native PDF export** — covered by the existing tuned print path (paper-style rendering, A4 portrait, `@page margin: 0` suppresses Chromium header/footer chrome). No library bundled.

## Side fixes that shipped along the way

- Pop-art theme (red / yellow / black ink / cream).
- Pop-art jumbotron explainer at the top of the builder.
- Halftone-scrollbar matching the theme.
- Custom `/404.html` with pop-art badge and "where you were probably trying to go" cards.
- `/gdpr.html` consolidating every GDPR-proof claim.
- `/forms.html`, `/received.html`, `/import.html` as standalone pages with unified navigation.
- Parallax background with a mirror overlay on the home page.
- Sticky footer (always at the bottom on short pages).
- Print output rewritten to render a paper-style form — no real `<input>` elements, just labels + underlines + checkbox marks. Consistent across browsers.
- Tooltips across the topbar controls + add-field chips + lock/undo/redo/test-fill buttons.
- Custom scrollbar.

## Next up (open work)

19. ✅ **Per-field image-size limit** — `file` / `signature` fields take `! maxsize=N` (MB). Smaller of (per-field, 5 MB global cap) wins. Limit shown under the file input as "Max N MB". Round-trips through YAML + JSON.

20. ✅ **Image format / MIME validation** — magic-byte sniffer in `fill.js` checks the first 16 bytes against JPEG / PNG / GIF / WebP / BMP / TIFF / HEIC / AVIF / PDF signatures. Rejects renamed files that don't match the field's `accept`. The answer is stored with the sniffed MIME, not the browser-reported one.

21. ✅ **Per-image dimension limit** — `! minwidth=N ! maxwidth=N ! minheight=N ! maxheight=N` on image file fields. Image loaded into an `Image` probe, natural dimensions checked, rejected with a specific toast if any rule fails. Builder UI surfaces only when the field accepts images.

22. ✅ **Standalone YAML validator** — *Validate only* button on `/import.html` runs the parser + validator without saving and reports a green "Valid YAML-style" badge with question / section / page counts and a per-type breakdown.

23. ✅ **Standalone JSON validator** — same button covers the JSON path: line/col pointer on `JSON.parse` errors, schema-level checks via the existing `validateForm` (unknown types, missing options, malformed widths, leading/trailing pagebreaks…), and a collapsible *Pretty-printed JSON* drawer when valid.

## What's still NOT done (intentionally, for now)

- YAML round-trip for `showIf` (use JSON for now or set it in the builder).
- Multiple files per `file` field (single file in v1).
- File upload progress bar (small files OK without one).
- One-click PDF download (option 3 chosen — Print → Save as PDF is the path).
- Form analytics / submission count per form.
- Email integration / cloud sync (deliberately not built — would break the GDPR-proof architecture).
- Pricing page / paywall.

---

## 24. ✅ Phase 1 — Multi-session workspace + reconnect + blank-correction portal

Plan file (full design, user-approved): `/Users/gradikayamba/.claude/plans/lucky-mapping-kite.md`

**Goal:** clinic uses ProxForm all day as a dashboard. Parallel patient sessions (N invites out at once, replies trickling back), reconnect without data loss if a patient drops, submit-and-purge of in-memory PHI, first-come ordering of submissions, blank correction portal from a completed submission (deliberately no answer-prefill — wrong-row leak risk).

User's three UX picks (locked in):
- Whole site is one in-page SPA-ish shell — Phase 2 (deferred).
- Dashboard home merges into `/received.html` — ✅ done.
- Manual reconnect button only (no auto-ICE-restart in v1) — ✅ done.

### Wire-protocol foundation (single-session unchanged)

- [js/builder.js](js/builder.js) — module-global `let sessionId = ''` + `newSessionId()` (UUID with `getRandomValues` fallback). Allocated lazily in `generateLink()`. Included in outgoing `{type:'form', nonce, sessionId, form}` payload. New `state-sync` handler wholesale-replaces `answers` with `msg.answers`.
- [js/fill.js](js/fill.js) — on receiving `form` message, if `msg.sessionId` set → switches `draftKey` to that ID before `restoreAnswers()`. After restore, if `answers` non-empty, emits one `{type:'state-sync', answers: lean}` (file blobs → `_pendingFile` placeholders).
- No storage schema change — `ProxStore.saveFillDraft(sessionId, ...)` already accepts any string key.

### Phase 1 deliverables (all shipped)

- ✅ [js/sessions.js](js/sessions.js) — `window.ProxSessions` multi-session manager. API: `create / connect / reconnect / end / get / list / sendCorrection / setLabel / on`. State machine `waiting → connecting → connected → (disconnected ↔ connecting) → submitted → closed`. Per-session record owns its own `pc`, `dc`, `answers`, `filesInProgress`, nonces. On submit → `ProxStore.saveSubmission` + purge `filesInProgress` (in-memory `answers` kept for the UI but never re-shared; the submission record in IndexedDB is canonical).
- ✅ [js/dashboard.js](js/dashboard.js) — owns the Active Sessions panel and the Send-new-invite picker on `/received.html`. Cards: short ID + label + form title + SAS + state pill + body with invite link, passphrase, reply-paste, action buttons. Live answer preview via inline `intake-cell` rendering.
- ✅ [received.html](received.html) — `<section id="active-sessions">` above `<section id="submissions">` (now `#submissions-list`). Send-new-invite form (saved-form picker + optional label). Loads `crypto.js`, `p2p.js`, `sessions.js`, `dashboard.js`. Existing submissions list untouched.
- ✅ Submissions list **Resend (blank)** action in [js/builder.js:1540](js/builder.js#L1540) → calls `ProxSessions.sendCorrection(submissionId)` → fresh blank session card. No answers attached.
- ✅ Session-card CSS in `css/style.css` (`.dash-section`, `.dash-sender`, `.active-sessions`, `.session-card`, state-pill colour-coding, expandable body, mobile grid-area fallback).
- ✅ Cache-bust `?v=9 → ?v=10` across all `*.html`; `sw.js` `CACHE = 'proxform-v10'` with `js/sessions.js` + `js/dashboard.js` added to ASSETS.
- ✅ Removed duplicate **File / photo** chip in `builder.html`.
- ✅ CLAUDE.md updated — now lists all pages/modules and documents the two-paths transitional state.

### Phase 2 — deferred

- SPA shell so navigation doesn't tear down sessions. Until shipped, the clinic has to stay on `received.html` for sessions to stay alive.
- Unify the two clinician session-host paths (legacy in `builder.js`, multi in `sessions.js`) — belongs in the SPA refactor, not before.
