# QuarkGIS

A zero-install web GIS that opens, edits and saves real QGIS projects (`.qgs` / `.qgz`) in the browser, rendered by QGIS core itself through [qgis-js](https://github.com/qgis/qgis-js) (QGIS compiled to WebAssembly).

**Live app:** https://ismailsunni.id/quarkgis/ · **Documentation:** https://ismailsunni.id/quarkgis/docs/ · **Product spec:** [docs/PRD.md](docs/PRD.md)

Everything runs client-side: nothing is uploaded. In Chrome and Edge, a project opened from your computer stays linked to its files and Save writes back to them; elsewhere a copy is kept in the browser.

## Features

| ID | Feature | Status | Acceptance result |
| --- | --- | --- | --- |
| F1 | Open .qgs/.qgz by file/folder picker, drag-and-drop, `?url=`, GeoPackage-embedded projects | ✅ | 10/10 reference projects open with no errors |
| F2 | QGIS-rendered map in the project CRS, pan/zoom, scale bar, coordinates | ✅ | Pixel diff vs QGIS Desktop: 9/10 projects < 1% (most < 0.2%); polygon labels 1.8% (label placement depends on font metrics) |
| F3 | Layer tree: visibility, groups, drag to reorder, rename, remove, opacity, legend | ✅ | Changes apply without a full reload |
| F4 | Identify with attribute popup | ✅ | Values read from QGIS |
| F5 | `maponly`, `layout=compact`, `panels=none` modes, share and embed links | ✅ | Map-only view tested |
| F6 | Attribute table: sort, filter by QGIS expression, select to zoom, virtual scrolling | ✅ | 100,000 features load and scroll (e2e test) |
| F7 | Style editor: single, categorized, graduated (equal interval, quantile, Jenks, pretty) | ✅ | Saved styles reopen identically in QGIS Desktop |
| F8 | Labels: field/expression, font, size, color, buffer, placement | ✅ | As F7 |
| F9 | QML import/export per layer, plus an Advanced QML editor | ✅ | Desktop QML applied verbatim |
| F10 | Save: in the browser (OPFS), `.qgz` download, project + data `.zip` | ✅ | Round-trip suite: 10/10 projects verified by QGIS Desktop |
| F11 | Add GeoPackage (with a layer picker), GeoJSON, Shapefile (+zip), FlatGeobuf, GeoTIFF, GeoParquet, KML, GPX, MBTiles | ✅ | CRS detected per format |
| F12 | Open data catalogs (STAC imagery and elevation, CKAN portals); remote layers: XYZ, WMS, WMTS, WFS, OGC API Features and Tiles, ArcGIS FeatureServer/MapServer/ImageServer/VectorTileServer, vector tiles, PMTiles, COG, files by URL | ✅* | Saved as QGIS layers; see notes |
| F13 | Editing (attributes, add/move/delete features) written to GeoPackage, with undo/redo | ✅ | Edits persist (saved in the browser), readable by Desktop |
| F14 | Processing: buffer, centroids, clip, difference, intersection, union, dissolve, join by location, merge, points along lines, reproject, … | ✅ | Outputs match Desktop's native algorithms (`scripts/compare_processing.py`) |
| F15 | Expression builder with QGIS's function list and live preview | ✅ | Evaluated by QGIS itself |
| F16 | QGIS Hub browser: apply styles, open projects, add layer definitions | ✅ | One-click style apply |
| F17–F23 | Publishing (M5): local-data blockers, CORS/credential warnings, secret stripping, embedded SVGs, share links, embed domain allowlist, versions | ✅* | Secret stripping unit-tested; see notes |

Also:

- **Navigation and output:** place search (OpenStreetMap Nominatim) and coordinate search, links that open the current view, show my location, coordinates in decimal degrees, DMS, UTM, MGRS or the project CRS, a coordinate grid, previous/next view, a right-click map menu, a time slider for temporal layers (QGIS temporal controller), measuring distance and area, elevation profiles from a GeoTIFF DEM, a basemap gallery, spatial bookmarks (saved in the project), an on-map QGIS legend, swipe and side-by-side compare, and map export as PNG up to 384 dpi or as a PDF map page (title, legend, scale bar, north arrow).
- **Data work:** feature selection (click, rectangle, polygon, freehand, expression, location) synced with the attribute table, field statistics with histograms, table joins (QGIS vector joins), field calculator and field management, layer export (GeoPackage, GeoJSON, FlatGeobuf, Shapefile, KML, CSV), CSV and Excel import, and a processing history to re-run tools.
- **Styling:** clean default styles and one-click suggestions for new layers; rule-based, heatmap and point cluster renderers; standard deviation and manual classes; scale-dependent visibility; raster band histograms and pixel values in Identify; raster pseudocolor, grayscale, hillshade and RGB; popups (display name and HTML map tips, shown in Identify and on hover); copy/paste style.
- **Editing:** snapping to visible layers, merge, split, move, rotate and explode, copy/paste of features between layers, and QGIS attribute forms (widgets, aliases, constraints, default values).
- **App:** a welcome tour, translations (German, French, Spanish, Indonesian), undo/redo for every project change, autosave with crash recovery, dark mode, "open project on launch" and map view settings (exportable), the project's saved view restored and written on save, an [embed API](docs/embed-api.md), a command palette (Ctrl/Cmd+K) with every action, keyboard shortcuts (press `?`), project properties (title, CRS), and a phone layout.

See [docs/feature-comparison.md](docs/feature-comparison.md) for how this compares with GeoLibre and RustGIS.

## How it works

- **The project file is the source of truth.** The open project is kept as its QGIS XML. Every edit (style, labels, tree, new layers) changes that XML, then QGIS reloads it, so what you see is exactly what gets saved, and Desktop reads it unchanged. New styles and layers are written from QGIS-generated templates (`scripts/make_templates.py`).
- **Rendering** is done by qgis-js in the project's CRS. Web layers QGIS can't fetch yet are drawn by OpenLayers in their layer-tree position, reprojected with proj4.
- **Remote data.** The engine has no network access yet ([QEP #294](https://github.com/qgis/QGIS-Enhancement-Proposals/issues/294)). Tiles, WMS and COGs are drawn by the browser; remote vector files and WFS are downloaded and drawn by QGIS. They are all saved as regular QGIS layers.
- **Editing** writes SQL into the layer's GeoPackage with the official SQLite WebAssembly build (it includes the R*Tree module GeoPackage spatial indexes need). Each edit stores its inverse for undo.
- **Processing** runs geometry in GEOS (the library QGIS's native algorithms use) compiled to WebAssembly; features, expressions and reprojection come from QGIS.
- **CRS definitions** come from QGIS's own `srs.db`, inside the engine.

### Notes and deviations from the PRD

- The PRD runs the engine in a Web Worker. It runs on the main thread: in a worker, qgis-js 4.2.3 downloads and starts but its Qt application never finishes initialising (spike, Oct 2026), so this needs upstream work in qgis-js. Heavy rendering already happens in the engine's own threads.
- Engine features qgis-js doesn't bind yet (project write, renderers, processing) are implemented on the XML document, with GEOS and with SQLite as described above, rather than as qgis-js bindings.
- **QGIS Hub:** hub.qgis.org doesn't send CORS headers, so a build step (`scripts/hub-mirror.mjs`) mirrors styles, GeoPackage projects and layer definitions into the site, refreshed weekly.
- **Publishing** stores the project file as a GitHub gist: unlisted (secret) or public links, versions from gist revisions, restorable. Publishing needs a GitHub token with the `gist` scope, kept only in the browser. Viewing needs no account. The embed allowlist is enforced by the app, not by a server. Paid-tier levers (billing, custom domains, view stats) need a backend and aren't part of this static app.
- **Embeds** on third-party pages can't run multithreaded WebAssembly unless the host page is cross-origin isolated; the app then offers to open the map in its own tab. A single-threaded qgis-js build would be needed (the PRD's open spike).
- MBTiles are drawn by the browser from the file (the engine's GDAL can't decode PNG/JPEG tiles); vector tiles from any source are drawn with a default style and only in Web Mercator projects.
- Label fonts: the browser preview uses the engine's built-in font; the chosen font is saved for Desktop.

## URL parameters

| Parameter | Effect |
| --- | --- |
| `?url=<project.qgz>` | Open a remote project. Data sources with relative paths are fetched next to it (the server must allow CORS). |
| `?gist=<owner>/<id>[&rev=<version>]` | Open a published map. |
| `layout=compact` | Hide the top bar; its actions move into a rail menu. |
| `panels=none` | Start with all panels closed. |
| `maponly` | Only the map, for iframes. |

Example: https://ismailsunni.id/quarkgis/?url=projects/world/world.qgz&maponly

## Development

```sh
npm install
npm run dev        # http://localhost:5173 (dev server sets COOP/COEP headers)
npm run check      # svelte-check / TypeScript
npm test           # unit tests (Vitest)
npm run test:e2e   # Playwright: reference renders, round-trip, features (builds and serves the app)
npm run build      # static site in dist/
node scripts/hub-mirror.mjs   # optional: mirror the QGIS Hub into public/hub
```

Stack: Vite, TypeScript, Svelte 5, OpenLayers, qgis-js 4.2.3 (pinned), SQLite WASM, GEOS WASM, proj4.

Generated assets (run with QGIS Desktop's Python, e.g. `QT_QPA_PLATFORM=offscreen PYTHONPATH=/usr/share/qgis/python python3 …`):

| Script | Output |
| --- | --- |
| `scripts/make_demo_project.py` | `public/projects/world` demo (Natural Earth) |
| `scripts/make_templates.py` | Empty project, default symbols and label settings |
| `scripts/make_functions.py` | Expression function list for the builder |
| `scripts/make_reference_projects.py` | 10 reference projects and their Desktop renders |
| `scripts/check_roundtrip.py` | Verifies projects saved by the round-trip test in Desktop |
| `scripts/compare_processing.py` | Compares processing outputs with Desktop's algorithms |

CI (`.github/workflows/test.yml`) runs unit tests, the Playwright suite, and the Desktop round-trip check in the `qgis/qgis` container. Pushes to `main` deploy to GitHub Pages; a service worker (`public/sw.js`) provides cross-origin isolation there and caches the engine.

## License

GPL-2.0-or-later, the same as QGIS and qgis-js.
