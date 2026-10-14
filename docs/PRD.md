# QGIS Web App — PRD

Oct 14, 2026 · @Sunni

## Overview

A zero-install web GIS that opens, edits and saves real QGIS projects in the browser, with rendering identical to QGIS Desktop because it runs QGIS core itself. Working name: QGIS Web.

The engine already exists: [qgis-js](https://github.com/qgis/qgis-js) compiles QGIS core to WebAssembly and can load a project and render it to images. It ships no application UI, no layer panel, no style editor, no attribute table. This product is that application.

**Positioning**

|  | GeoLibre | qgis-js today | QGIS Web (this product) |
| --- | --- | --- | --- |
| What it is | Full browser GIS app | Engine + demos | Full browser GIS app |
| Rendering | MapLibre / deck.gl | QGIS core (wasm) | QGIS core (wasm) |
| Project format | Own .geolibre.json | .qgs / .qgz (read) | .qgs / .qgz (read + write) |
| QGIS style fidelity | Approximate | Exact | Exact |
| UI | Simple, modern | None | Simple, modern |

The bet: GeoLibre proves people want a light, private, in-browser GIS. QGIS users want that too, but only if their existing projects open unchanged and can go back to Desktop without loss.

## Goals and non-goals

The one goal that overrides the rest: a project round-tripped through QGIS Web opens in QGIS Desktop with nothing lost.

**Goals**

- Open any .qgs / .qgz with local data and render it exactly as QGIS Desktop does.
- Cover the everyday 80%: layer tree, identify, attribute table, basic styling, labels, save.
- Run fully client-side; data never leaves the browser unless the user adds a remote URL or shares.
- A UI simple enough for a first-time GIS user, without hiding QGIS concepts from power users.
- Push all engine work upstream into qgis-js rather than forking it.

**Non-goals (v1)**

- Re-creating the full QGIS Desktop UI or porting Qt widgets.
- PyQGIS, Python plugins and Python-based processing algorithms.
- Direct PostgreSQL/PostGIS connections.
- Print layouts and atlas.
- Mobile-first editing; phones get view and identify only.

## Users and use cases

The primary user is someone who already has a QGIS project and needs to show, check or lightly edit it where Desktop isn't available.

| User | Situation | Core use case |
| --- | --- | --- |
| GIS analyst | Sends projects to non-GIS colleagues | Share a link; the recipient sees the exact map, no install |
| Field / ops staff | Locked-down or borrowed laptop, Chromebook | Open a .qgz, identify features, fix attributes |
| Trainer / workshop host | Mixed OS laptops, slow install time | Run a QGIS workshop in the browser from minute one |
| Plugin and style authors | Publish styles and projects on QGIS Hub | Live preview of a style or project before download |
| Developers | Need QGIS cartography in a web page | Embed a map-only view of a project via URL |

## Design principles

Map first, panels second: the map fills the screen and every panel can collapse.

1. **QGIS is the source of truth.** The UI never keeps its own copy of the project. Every action calls the engine, then re-reads. No feature ships if it can't round-trip.
2. **Few panels, one at a time.** A left rail of icons opens one side panel. No floating dock-widget sprawl.
3. **Progressive disclosure.** Simple forms by default; an Advanced toggle and a QML import/export escape hatch for anything the forms don't cover.
4. **Keyboard and command palette.** Every action reachable via Ctrl/Cmd+K, so the toolbar stays small.
5. **Familiar QGIS words.** Layers, Identify, Attribute Table, Symbology, Labels. A Desktop user should never need a glossary.

**Borrowed from GeoLibre**

- Clean, flat shell with a single left panel and a full-bleed map ([GeoLibre](https://geolibre.app/)).
- URL-driven views: `?url=` to open a remote project, plus `layout=compact`, `panels=none` and `maponly` modes for sharing and embedding.
- Privacy as a feature: a static site with no accounts or analytics; data stays in the browser unless the user loads a remote URL or shares.
- Drag-and-drop anything onto the map to open it.

**Deliberately different from GeoLibre**

- The project file is a real .qgz, not an app-specific JSON format.
- Styling is QGIS symbology, not MapLibre style layers.

## UI layout

The shell is four fixed regions around a full-bleed map: top bar, left icon rail, one side panel, and a bottom drawer.

&#91;embedded content: App shell wireframe · top bar, left rail, one side panel, map, bottom drawer\]

The rail switches the single side panel; clicking the active icon collapses it. The attribute table opens as a bottom drawer so the map stays visible.

| Rail item | Panel contents | Milestone |
| --- | --- | --- |
| Layers | Layer tree, visibility, groups, opacity | M1 |
| Add data | File picker, drag-and-drop, remote URL | M1 / M3 |
| Style | Symbology, labels, QML import/export | M2 |
| Table | Opens the attribute table drawer | M2 |
| Tools | Processing algorithm search and forms | M4 |
| Hub | Browse and apply QGIS Hub styles and projects | M4 |

**View modes** (URL parameters, as in GeoLibre): full app by default; `layout=compact` hides the top bar into a menu; `panels=none` starts with all panels closed; `maponly` shows only the map for iframes. On phones the rail becomes a bottom tab bar and panels open as sheets.

## Feature requirements

Features are grouped by milestone; each one is done only when its acceptance check passes.

| ID | Milestone | Feature | Acceptance check |
| --- | --- | --- | --- |
| F1 | M1 Viewer | Open .qgs/.qgz by file picker, drag-and-drop or `?url=` | 10 reference projects open with no errors |
| F2 | M1 Viewer | Render map via qgis-js tiles with pan, zoom, scale bar, coordinates | Pixel diff vs QGIS Desktop export under 1% on reference projects |
| F3 | M1 Viewer | Layer tree: visibility, groups, reorder, opacity | Changes reflected in render under 1 s |
| F4 | M1 Viewer | Identify tool with attribute popup | Values match Desktop for every reference layer |
| F5 | M1 Viewer | Share and embed modes (`maponly`, `compact`, `panels=none`) | Map-only view loads in an iframe |
| F6 | M2 Editor | Attribute table with sort, filter by expression, select-to-zoom | 100k-feature layer scrolls smoothly |
| F7 | M2 Editor | Simple style editor: single, categorized, graduated | Edited style saved as .qgz renders identically in Desktop |
| F8 | M2 Editor | Labels: field, font, size, buffer, placement | Same as F7 |
| F9 | M2 Editor | QML import/export per layer | Desktop-made QML applies with no loss |
| F10 | M2 Editor | Save project to .qgz (download + OPFS) | Round-trip test suite passes |
| F11 | M3 Data | Add layers: GeoPackage, GeoJSON, Shapefile zip, GeoTIFF, FlatGeobuf, GeoParquet | Each format loads and styles |
| F12 | M3 Data | Remote layers: XYZ, COG, WMS/WMTS | Depends on upstream network work |
| F13 | M3 Data | Attribute and geometry editing with undo, written to GeoPackage | Edits persist across reload |
| F14 | M4 Analysis | Native C++ processing algorithms (buffer, clip, dissolve, reproject...) | Outputs match Desktop |
| F15 | M4 Analysis | Expression builder with function list | Desktop expressions evaluate identically |
| F16 | M4 Analysis | QGIS Hub browser: preview and apply styles and projects | One-click apply of a Hub style |

## Technical architecture

qgis-js runs in a Web Worker and owns the only copy of the project; the UI thread holds a read-only cache it refreshes after each call.

&#91;embedded content: Architecture · UI thread, engine worker, storage and network\]

Every user action is one async call: the shell asks the engine to change something, the engine returns JSON or tile buffers, and the cache and map update. Selection highlights and edit sketches draw in an OpenLayers vector overlay, because QGIS output arrives as images.

- **Stack:** Vite, TypeScript, React or Svelte, OpenLayers, Comlink.
- **Persistence:** OPFS for projects and GeoPackages; download and upload of .qgz as the portable path.
- **Threads:** multithreaded wasm needs cross-origin isolation, so the host sets COOP/COEP or the app ships a service-worker shim.
- **Testing:** a CI suite opens reference projects, applies scripted edits, saves .qgz, and diffs renders against QGIS Desktop exports.

## Required qgis-js API surface

The app is blocked by the engine API, so binding work is planned per feature and contributed upstream. Today qgis-js exposes project loading and rendering; network layers, PyQGIS and Qt GUI are listed as unsupported ([README](https://github.com/qgis/qgis-js)).

| Needed for | QGIS classes to bind (embind) | Status |
| --- | --- | --- |
| F1–F2 | QgsProject read, QgsMapSettings, render to ImageData | Exists |
| F3 | QgsLayerTree, QgsLayerTreeLayer/Group, QgsMapLayer opacity | To build |
| F4, F6 | QgsVectorLayer::getFeatures, QgsFeatureRequest, QgsFields | To build |
| F6, F15 | QgsExpression, QgsExpressionContext | To build |
| F7–F9 | QgsFeatureRenderer (single/categorized/graduated), QgsSymbol, QgsPalLayerSettings, QML read/write | To build |
| F10 | QgsProject::write to .qgz in the virtual filesystem | To build |
| F11 | Layer creation through GDAL/OGR providers | Partial |
| F12 | Qt network over fetch, GDAL /vsicurl/ | Upstream (QEP #294) |
| F13 | Edit buffer, undo stack, GeoPackage write | To build |
| F14 | QgsProcessingRegistry, native algorithm provider | To build |

Rule: a binding returns plain JSON or transferable buffers, never long-lived C++ handles, so the worker boundary stays simple.

## Milestones and roadmap

Four milestones, each closed by a compatibility gate; the M2 round-trip gate is the one that makes this a QGIS app rather than a viewer.

&#91;embedded content: Roadmap · 4 milestones, 4 gates, upstream work per milestone (not to scale)\]

Phases are shown at equal width; durations are not set yet. Each milestone's upstream bindings start before its UI work, since the UI can't ship without them.

## Cloud sharing (paid, M5)

Users can publish a project to a share link or an embed, but only if every layer reads from a remote source; QGIS Web never hosts user data, only the project file.

This keeps hosting to a few kilobytes per project and avoids storing, licensing or securing anyone's data. It depends on remote-layer support (F12), so M5 follows M3.

| ID | Feature | Acceptance check |
| --- | --- | --- |
| F17 | Publish check: block publishing if any layer is local (file path, memory layer, local GeoPackage), and list each blocking layer | A project with one local layer cannot be published; the blocker names that layer |
| F18 | Publish check: warn on remote sources that block cross-origin requests (no CORS) or need credentials | Warning shown before upload; the viewer sees a clear per-layer error, not a blank map |
| F19 | Strip auth config and credentials from the published .qgs | No secrets in any published file (CI test) |
| F20 | Make styles self-contained: embed local SVG markers and images in the project | Published project renders without the author's local files |
| F21 | Share link: public or unlisted, opens in `compact` or `maponly` mode | Link opens on a second machine with no account |
| F22 | Embed snippet: iframe with `maponly`, limited to owner-approved domains | Embed loads only on listed domains |
| F23 | Republish updates the same link; previous versions kept | Old link shows the new version; history restorable |

**Allowed sources:** XYZ, WMS, WMTS, WFS, vector tiles, and remote files by URL (COG, FlatGeobuf, GeoParquet, GeoJSON).

**Paid tier levers:** private links, allowed embed domains, no watermark, custom domains, view stats, version history. The free tier allows public links.

**Open question:** embeds on third-party pages can't use multithreaded wasm unless the host page is cross-origin isolated. Spike a single-threaded build before promising embeds.

- [ ] Spike: qgis-js without threads inside a plain iframe

## Risks, open questions, success metrics

The biggest risk is load time: an early qgis-js release shipped a 42.8 MB .wasm, about 12.75 MB gzipped ([npm](https://npmjs.com/package/qgis-js)).

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Large wasm download | Slow first open, poor on mobile | Service-worker cache, splash with progress, measure each release |
| COOP/COEP headers for threads | Static hosts like GitHub Pages can't set them | coi-serviceworker shim or a host that sets headers |
| Binding work slower than UI work | Features stall on the engine | Bindings planned per feature (see API table), upstream early |
| Remote layers depend on upstream | M3 slips | Ship local formats first; contribute to QEP #294 |
| Style editor complexity | Endless UI scope | Three renderer types only; QML import/export for the rest |
| Upstream API churn on QGIS 4.x | Rebinding cost | Pin qgis-js versions; round-trip tests in CI |

**Open questions**

- [ ] Product name, and whether to propose it as an official QGIS project.
- [ ] React or Svelte for the shell?
- [ ] OpenLayers only, or MapLibre for basemaps under QGIS tiles?
- [ ] Desktop wrapper (Tauri) later, as GeoLibre does?
- [ ] Hosting: GitHub Pages with a shim, or Netlify/Cloudflare with headers?

**Success metrics**

- 95% of reference projects round-trip with no diff in Desktop.
- First map visible under 10 s on a cold load over 20 Mbps; under 2 s when cached.
- A first-time user opens a project and changes a layer color unaided in under 2 minutes.

**Sources**

- [qgis/qgis-js repository](https://github.com/qgis/qgis-js)
- [qgis-js on npm](https://npmjs.com/package/qgis-js)
- [QEP #294: remote data in WebAssembly builds](https://github.com/qgis/QGIS-Enhancement-Proposals/issues/294)
- [GeoLibre](https://geolibre.app/) and [getting started](https://geolibre.app/getting-started/)
