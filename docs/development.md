# Development

The source is on [GitHub](https://github.com/ismailsunni/qgis-web), under GPL-2.0-or-later like QGIS.

## Setup

```sh
npm install
npm run dev        # http://localhost:5173 (the dev server sets COOP/COEP headers)
npm run check      # svelte-check / TypeScript
npm test           # unit tests (Vitest)
npm run test:e2e   # Playwright: reference renders, round-trip, features
npm run build      # static site in dist/
```

Stack: Vite, TypeScript, Svelte 5, OpenLayers, qgis-js 4.2.3 (pinned), SQLite WASM, GEOS WASM, proj4.

## Code map

| Path | What |
| --- | --- |
| `src/lib/doc.ts` | The project XML document, loading it in QGIS, saving |
| `src/lib/map.ts` | The OpenLayers map: QGIS render layers and browser-drawn web layers |
| `src/lib/style.ts`, `raster.ts` | Renderers, labels, classification, QML |
| `src/lib/editing.ts`, `editmap.ts`, `editops.ts` | Feature editing on GeoPackages |
| `src/lib/processing.ts` | Algorithms (GEOS) |
| `src/lib/remote.ts` | Web layers: data sources, capabilities, downloads |
| `src/lib/actions.ts` | Opening/saving, identify, the action search |
| `src/i18n/*.json` | Translations |
| `src/components/` | The UI (Svelte) |
| `tests/` | Unit and end-to-end tests, reference projects |
| `scripts/` | Generated assets and checks against QGIS Desktop |

## Tests

- **Unit tests** (Vitest) cover parsers, classification breaks (checked against QGIS's), coordinates and statistics.
- **End-to-end tests** (Playwright) open ten reference projects and compare the renders with QGIS Desktop's pixel by pixel, save projects and check them in QGIS Desktop (in the `qgis/qgis` Docker image, on CI), and exercise the features.
- `scripts/compare_processing.py` runs the same algorithms in QGIS Desktop and compares the outputs.

## Translations

The UI text is English; translations live in `src/i18n/<code>.json`, keyed by the English text. To add or update a language:

```sh
node scripts/i18n-keys.mjs           # coverage per language
node scripts/i18n-keys.mjs --write   # add new keys (empty) to every language file
```

Fill in the empty values, keeping `{placeholders}` as they are, and add the language to `LANGUAGES` in `src/lib/i18n.ts` for a new one.

## Documentation

This site is built with [Zensical](https://zensical.org) from `docs/`:

```sh
pip install zensical
zensical serve                               # http://localhost:8000
node scripts/docs-screenshots.mjs <app-url>  # refresh the screenshots
```

It is published with the app, at `/qgis-web/docs/`.
