# DevLens (VS Code Extension)

Bug Book, Endpoint Explorer, and Actions — natively in VS Code, replacing the
pywebview desktop app.

## Install (unpublished, local `.vsix`)

1. In VS Code: Extensions view → `···` menu → **Install from VSIX...**
2. Pick `devlens-0.1.0.vsix`.
3. Open a Django project folder. The DevLens icon appears in the Activity Bar.

## What's here (Phases 0–3 of the migration plan)

- **Bug Book** — project-agnostic, same as before. `+` in the view title to
  log a bug; click one to edit.
- **Endpoint Explorer** — scan button in the view title, or right-click any
  `urls.py` → "DevLens: Scan for Endpoints". Requires a Python interpreter
  on PATH (or configured via the Python extension) — it shells out to the
  bundled `scanner.py`, unchanged from the original.
- **Actions** — click an action to run it. "Build Frontend" and "Python
  Migrations" are seeded automatically per project on first open. Regular
  command steps stream into a real integrated terminal; Build Frontend
  keeps its own build-then-copy flow (same as the original `api.py`).

## Known gaps / next passes

- Action step editing is raw JSON in a webview, not a per-field form.
- Bug/endpoint editors are plain HTML forms, not the original shadcn/React
  components — same fields and behavior, different rendering layer.
- Multi-root workspaces use the first folder as "the" project.
- No settings UI yet for e.g. overriding the Python interpreter directly.

## Dev loop

```
npm install
npm run watch      # esbuild --watch, rebuilds dist/extension.js on save
```

Then F5 in VS Code (with this folder open) to launch an Extension
Development Host with DevLens loaded.
