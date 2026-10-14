# QGIS Web

A zero-install web GIS that opens real QGIS projects (`.qgs` / `.qgz`) in the browser, rendered by QGIS core itself through [qgis-js](https://github.com/qgis/qgis-js) (QGIS compiled to WebAssembly).

**Live app:** https://ismailsunni.id/qgis-web/ · **Product spec:** [docs/PRD.md](docs/PRD.md)

Everything runs client-side: projects and data stay in your browser unless you open a remote URL.

## Status

Milestone M1 (Viewer) from the PRD, plus the read-only part of M2:

| ID | Feature | Status |
| --- | --- | --- |
| F1 | Open .qgs/.qgz by file/folder picker, drag-and-drop, or `?url=` | ✅ |
| F2 | QGIS-rendered map in the project CRS, pan/zoom, scale bar, coordinates | ✅ |
| F3 | Layer tree: visibility, groups, opacity, legend | ✅ (reorder needs a qgis-js binding) |
| F4 | Identify with attribute popup | ✅ |
| F5 | `maponly`, `layout=compact`, `panels=none` view modes, share/embed links | ✅ |
| F6 | Attribute table: sort, filter by QGIS expression, select-to-zoom, virtual scrolling | ✅ |
| F7–F10 | Style/label editing, QML, save .qgz | ⏳ blocked on upstream bindings (see PRD API table) |
| F11+ | Add layers, remote layers, editing, processing, Hub | ⏳ M3/M4 |

Also included: a command palette (Ctrl/Cmd+K) listing every action, and a phone layout (bottom tab bar, view and identify only).

## URL parameters

| Parameter | Effect |
| --- | --- |
| `?url=<project.qgz>` | Open a remote project. Data sources with relative paths are fetched next to it (the server must allow CORS). |
| `layout=compact` | Hide the top bar; its actions move into a rail menu. |
| `panels=none` | Start with all panels closed. |
| `maponly` | Only the map, for iframes. |

Example: `https://ismailsunni.id/qgis-web/?url=projects/world/world.qgz&maponly`

## Development

```sh
npm install
npm run dev      # http://localhost:5173 (dev server sets COOP/COEP headers)
npm run check    # svelte-check / TypeScript
npm run build    # static site in dist/
```

Stack: Vite, TypeScript, Svelte 5, OpenLayers, qgis-js 4.2.3 (pinned).

Notes:

- qgis-js uses multithreaded wasm, which needs `SharedArrayBuffer` and therefore cross-origin isolation. GitHub Pages can't set headers, so the app ships [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker).
- The PRD runs the engine in a Web Worker behind Comlink. For now it runs on the main thread, because the qgis-js API adapter and `@qgis-js/ol` sources expect `window`. Rendering already happens in the engine's own pthreads.
- The demo project (`public/projects/world`) is generated from Natural Earth data with `scripts/make_demo_project.py`, using QGIS Desktop's Python.

Pushes to `main` deploy to GitHub Pages via `.github/workflows/pages.yml`.

## License

GPL-2.0-or-later, the same as QGIS and qgis-js.
