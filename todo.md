# ProxForm — Builder TODO

Open items for the form-builder side, ordered roughly by bang-for-buck.

## Quick wins (each ~30 min)

1. **Duplicate field** — clone the current row with all its settings (label, type, required, half-width, options). Up/down/remove are there; clone is the missing twin.
2. **Placeholder / help text** — one-line hint shown under each field on the patient view. Schema gets a new `hint` key; `render.js` shows it; import format gets an indented `> hint text` line.
3. **Section description** — sections currently only carry a title. Add an optional subtitle line for "instructions for this group."
4. **Saving… / Saved indicator** — auto-save is silent right now; a tiny pill near the title gives users confidence the draft is persisted.
5. **Default value per field** — prefill a field's initial answer. Useful for known-good defaults (e.g. country = "Belgium").
6. **Test-fill mode** — toggle the preview from disabled to interactive so the clinician can rehearse the form before sharing. Submit just clears, doesn't transmit.

## Mid-effort, high impact

7. **Form templates / starter library** — the four vertical templates in `import.html` already exist as text. Wire a "Start from a template" button on `forms.html`. Big onboarding lift.
8. **Drag-and-drop reorder** — replaces the up/down arrows. More natural UX, but adds DnD wiring (HTML5 drag API or pointer events).
9. **Field validation rules** — min/max for numbers, min/max length for text, regex pattern for text. Schema bloat is real but most form builders have it.
10. **Undo / redo for the editor** — particularly for accidental delete. One stack of recent operations.
11. **Form search / filter** — in a long form, find a field by label. Filter the editor list as the user types.
12. **Question numbering toggle** — auto-number visible questions in the patient view (`1. Full name`, `2. DOB`, …). Skip sections in the count.
13. **Field-width: third / quarter columns** — currently only full / half. A quarter-width option lets four short fields share a row.

## Big features

14. **Conditional logic (show-if / skip-if)** — "show field B only if field A = yes." Significant schema + render work, but it's the #1 missing capability vs. Typeform/Jotform.
15. **Multi-page forms** — already noted in `CLAUDE.md` as "not done yet." Adds a page-break field type and pagination in the patient view.
16. **File / photo upload field** — unlocks legal + hospitality verticals (ID scans, insurance cards). Chunk bytes over the existing WebRTC data channel; no backend, GDPR posture preserved. Needs: chunking + reassembly + progress UI + size cap.
17. **Signature field** — canvas-based, captures into a base64 PNG, transmitted with the answer payload.
18. **Native PDF export** — currently relies on the browser's "Save as PDF" print dialog. Add `jsPDF` (or similar) for a proper PDF of the completed form.

## Recommended next batch

The smallest useful PR: **#1 (duplicate), #2 (hint), #4 (saving indicator)** — all three are pure schema/UI additions with no new architecture.

The biggest forward step: **#16 (file/photo upload)** — real piece of work and deserves its own session, but it's the gateway to the legal and hospitality verticals.
