# Feature comparison: GeoLibre, RustGIS and QuarkGIS

October 2026. Sources: the GeoLibre repository ([README](https://github.com/opengeos/GeoLibre), `docs/features.md`, user guide) and the RustGIS repository ([README](https://github.com/opengeos/RustGIS), `ROADMAP.md`, user guide), compared with QuarkGIS as of commit `545ac3d` (inventory updated after the "worth adding" items were built).

The goal is a list to decide from, not a plan: part 1 inventories what the two apps do, part 2 sorts what QuarkGIS lacks into worth adding, maybe later, and not needed, judged against the [PRD](PRD.md).

**Legend:** ✅ has it · ◐ partly · — doesn't have it. Effort for QuarkGIS: **S** about a day, **M** a few days, **L** a week or more.

## The three apps in one paragraph each

- **GeoLibre** (TypeScript, React, MapLibre, DuckDB-WASM, deck.gl, Tauri): a very broad cloud-native GIS for web, desktop, iOS, Android and Jupyter. Its own `.geolibre` project format; imports QGIS and ArcGIS Pro projects (lossy). Four rendering engines, 1,000+ WASM processing tools, dozens of data-catalog plugins, AI assistant, collaboration, story maps.
- **RustGIS** (pure Rust, egui, tiny-skia; desktop and WASM): an ArcGIS Pro-like desktop GIS with a ribbon, where every action is a scriptable command (CLI, Python, MCP). Its own `.rgis` format. Strong on editing, data design, layouts/reports, and sharing to open formats.
- **QuarkGIS** (this project): opens, edits and saves real `.qgs`/`.qgz` projects, rendered by QGIS itself; anything saved opens unchanged in QGIS Desktop. Narrower by design (PRD: "the everyday 80%"), but the only one of the three with exact QGIS rendering and lossless round-trip.

## Part 1. Inventory

### Interface and app

| Feature | GeoLibre | RustGIS | QuarkGIS |
| --- | --- | --- | --- |
| Command palette (Ctrl/Cmd+K) | ✅ | ✅ | ✅ |
| Keyboard shortcuts, shortcut cheat sheet | ✅ | ✅ | ✅ |
| Undo/redo for layer and style changes | ✅ | ✅ (everything) | ✅ |
| Dark mode | ✅ | ✅ | ✅ |
| Translations (i18n) | ✅ 20 languages, RTL | ✅ 16 languages | ◐ (5 languages) |
| Accessibility pass (axe, screen readers) | ✅ | — | ◐ |
| Phone layout | ✅ | — | ✅ |
| UI profiles / customizable menus or ribbon | ✅ | ✅ | — |
| Startup options (welcome, blank, last, specific project) | ✅ | ✅ | ✅ |
| Startup map view / projection / extent | ✅ | ✅ | ✅ (project's saved view or full extent) |
| Color-vision-deficiency preview | ✅ | — | — |
| Error boundaries keep the app usable | ✅ | — | ◐ |
| Settings import/export | ✅ | — | ✅ |

### Map and basemaps

| Feature | GeoLibre | RustGIS | QuarkGIS |
| --- | --- | --- | --- |
| Basemap gallery with previews | ✅ | ✅ (5 offline basemaps) | ✅ (8 basemaps, with credits) |
| Vector basemaps / MapLibre styles | ✅ | ✅ | — |
| Projections (Equal Earth, Robinson, any EPSG) | ◐ (ArcGIS engine) | ✅ | ✅ (QGIS, any CRS) |
| 3D globe | ✅ (Cesium, MapLibre globe) | ✅ | — |
| 3D terrain, 3D Tiles, I3S, point clouds, Gaussian splats | ✅ | ◐ (2.5D extrusion) | — |
| Multiple rendering engines (MapLibre, Mapbox, Cesium, ArcGIS) | ✅ | — | — (QGIS renders) |
| Planetary basemaps (Moon, Mars…) | ✅ | — | — |
| Split / side-by-side linked views | ✅ | ✅ | ✅ |
| Swipe compare | ✅ | ✅ | ✅ |
| Scale bar, coordinates readout | ✅ | ✅ | ✅ |
| Coordinates in DMS / UTM / MGRS, grid overlays | ✅ | ◐ | ✅ (decimal, DMS, UTM, MGRS, project CRS; lat/lon grid) |
| Go to coordinate / place search (geocoding) | ✅ | ✅ (Go To XY, locators) | ✅ |
| Bookmarks | ✅ | ✅ | ✅ (saved in the project) |
| Extent history (back/forward) | ✅ | ✅ | ✅ |
| Measure distance and area | ✅ | ✅ | ✅ |
| Right-click map context menu (copy coordinate, quick analysis) | ✅ | — | ✅ |
| On-map legend | ✅ | ✅ | ✅ (QGIS legend) |
| Annotations / graphics layer (text, arrows, shapes) | ✅ | ✅ | — |
| Time slider (temporal data) | ✅ | — | ✅ (QGIS temporal settings) |
| Timelapse, weather overlays, sun simulation, Wikipedia cards | ✅ | — | — |
| Elevation profile, line of sight, viewshed | ✅ | ✅ | ◐ (profile from a GeoTIFF DEM) |

### Data in

| Feature | GeoLibre | RustGIS | QuarkGIS |
| --- | --- | --- | --- |
| GeoPackage, GeoJSON, Shapefile (+zip), FlatGeobuf, GeoParquet, KML, GPX, GeoTIFF/COG | ✅ | ✅ | ✅ |
| KMZ, GML, TopoJSON, MapInfo MIF | ◐ | ✅ | — (KML/GML via GDAL may work, untested) |
| CSV/TSV with X/Y or WKT columns | ✅ | ✅ | ✅ |
| Excel / OpenDocument spreadsheets | ✅ | ✅ | ◐ (Excel) |
| DXF / DWG (CAD) | ✅ | ✅ (DXF) | — |
| OpenStreetMap PBF | ✅ | ✅ | — |
| LiDAR (LAS, LAZ, COPC) | ✅ | ✅ | — |
| NetCDF, HDF5, Zarr | ✅ | ✅ | — |
| PMTiles, MBTiles | ✅ | ✅ | ✅ |
| Geotagged photos (EXIF) | ✅ | ✅ | — |
| XYZ, WMS, WMTS, WFS, vector tiles, COG by URL | ✅ | ✅ | ✅ |
| OGC API Features / Tiles | ✅ | ✅ | ✅ |
| ArcGIS REST (Feature/Map/Image/VectorTile Server) | ✅ | ✅ | ✅ |
| STAC catalogs | ✅ | — | — |
| Data-catalog plugins (Planetary Computer, Earth Engine, Overture, HF, NASA…) | ✅ (dozens) | — | — |
| Databases (PostGIS, SQL Server, DuckDB, Iceberg) | ✅ | ✅ (desktop) | — (PRD non-goal) |
| Private cloud storage (S3) | ✅ | — | — |
| Layer picker for multi-layer GeoPackage | ✅ | — | ✅ |
| Drag and drop files | ✅ | ✅ | ✅ |
| QGIS project files (.qgs/.qgz) | ◐ (import, lossy) | — | ✅ (native, lossless) |

### Layers, styling, labels

| Feature | GeoLibre | RustGIS | QuarkGIS |
| --- | --- | --- | --- |
| Layer tree: groups, visibility, opacity, reorder, rename | ✅ | ✅ | ✅ |
| Group opacity, multi-select, sort A–Z | ✅ | — | — |
| Single, categorized, graduated | ✅ | ✅ | ✅ |
| Rule-based renderer (form) | ✅ | — | ✅ |
| Proportional symbols | ✅ | ✅ | ◐ (via QML) |
| Heatmap, point clustering renderers | ✅ | ✅ (aggregation bins) | ✅ |
| More classification modes (std dev, manual breaks) | ✅ | — | ✅ (as QGIS) |
| Custom color ramps (import QGIS/GDAL/GMT ramps) | ◐ | ✅ | — |
| Marker library, SVG/image markers, fill patterns | ✅ | ◐ | ◐ (Hub styles, QML) |
| Blend modes | ✅ | ✅ | ◐ (via QML) |
| Scale-dependent visibility | ✅ | ✅ | ✅ |
| Raster styling forms (stretch, pseudocolor, hillshade, RGB) | ✅ | ✅ | ✅ |
| Raster histogram, pixel value identify | ✅ | — | ✅ (GeoTIFF) |
| Label placement, buffer, expressions | ✅ | ✅ | ✅ |
| Label-to-annotation conversion | — | ✅ | — |
| Copy/paste style between layers | ✅ | ✅ | ✅ |
| Style library / presets | ✅ | ✅ | ◐ (QGIS Hub) |
| Style interchange (SLD, Mapbox GL style) | ✅ | ✅ (MapLibre out) | ◐ (QML only) |
| Popup / map tip designer | ✅ | ✅ | ✅ (QGIS map tips) |
| Smart default styling on add | ✅ | — | ✅ (palette, layer order, style suggestions) |
| Masking, extrusion (2.5D) | ✅ | ✅ | ◐ (via QML; QGIS renders it) |

### Attribute data and selection

| Feature | GeoLibre | RustGIS | QuarkGIS |
| --- | --- | --- | --- |
| Attribute table: sort, filter, zoom to row, virtual scrolling | ✅ | ✅ | ✅ |
| Multi-row selection synced with the map | ✅ | ✅ | ✅ |
| Select on map (click, rectangle, polygon) | ✅ | ✅ | ✅ (also freehand) |
| Select by expression / attributes | ✅ | ✅ | ✅ |
| Select by location | ✅ | ✅ | ✅ |
| Field calculator, add/delete/rename fields | ✅ | ✅ | ✅ |
| Virtual fields, joins | ✅ | ✅ (relationships) | ◐ (joins) |
| Attribute forms (widgets, constraints) | ✅ | ✅ (domains, subtypes, rules) | ✅ (from the project) |
| Field statistics, charts | ✅ | ✅ | ✅ (statistics, histogram) |
| Export layer (GeoJSON, GPKG, CSV, Shapefile…) | ✅ | ✅ | ✅ (GeoPackage, GeoJSON, FlatGeobuf, Shapefile, KML, CSV) |
| Expression builder with live preview | ✅ | ◐ | ✅ (QGIS functions) |
| SQL workspace (DuckDB, PGlite) | ✅ | ◐ (where clauses) | — |

### Editing

| Feature | GeoLibre | RustGIS | QuarkGIS |
| --- | --- | --- | --- |
| Add / delete features, edit attributes | ✅ | ✅ | ✅ |
| Move vertices | ✅ | ◐ (planned) | ✅ |
| Undo/redo | ✅ | ✅ | ✅ |
| Snapping to other layers | ✅ | ✅ | ✅ |
| Move, rotate, scale, merge, split, explode | ◐ | ✅ | ◐ (no scale) |
| Copy/paste features | — | ✅ | ✅ |
| Topology rules / topological digitizing | ✅ | ✅ | — |
| Feature templates, editor tracking | ✅ | ✅ | — |
| Write back to services (ArcGIS, SQL Server, GeoLens) | ✅ | — | — |
| Field collection with GPS, NMEA receivers | ✅ | — | — (PRD: phones view only) |

### Processing and analysis

| Feature | GeoLibre | RustGIS | QuarkGIS |
| --- | --- | --- | --- |
| Core vector tools (buffer, clip, dissolve, intersection…) | ✅ | ✅ | ✅ (14, match Desktop) |
| Union, spatial join, merge, points along lines | ✅ | ◐ | ✅ (match Desktop) |
| 1,000+ Whitebox/GeoLibre WASM tools (terrain, hydrology, LiDAR) | ✅ | ✅ | — |
| Raster tools (hillshade, slope, calculator, zonal stats) | ✅ | ✅ | — |
| Model builder | ✅ | ✅ | — |
| Processing history, re-run | ✅ | ✅ | ✅ (this session) |
| Batch runs | ✅ | — | — |
| Network: routing, isochrones | ✅ | ✅ (shortest path) | — |
| Geocoding | ✅ | ✅ (locators) | — |
| Spectral indices, classification, change detection | ✅ | ✅ | — |
| AI segmentation, object detection | ✅ | ✅ (pixel classification) | — |
| H3 / DGGS grids | ✅ | — | — |
| Georeferencing | ✅ | ✅ | — |
| Format conversion (to GeoParquet, PMTiles, COG) | ✅ | ✅ | — |

### Output, sharing and collaboration

| Feature | GeoLibre | RustGIS | QuarkGIS |
| --- | --- | --- | --- |
| Save project, Save As, open recent | ✅ | ✅ | ✅ |
| Export map image (PNG at DPI) | ✅ | ✅ | ✅ |
| Print layout / atlas / PDF | ✅ | ✅ | ◐ (quick PDF map page) |
| Reports, presentations, story maps, dashboards | ✅ | ✅ | — |
| Standalone HTML export | ✅ | ✅ | — |
| Share links, embed, map-only mode | ✅ | ◐ (static files) | ✅ |
| Share-readiness check | ✅ | — | ✅ |
| Versions / restore published map | ✅ | — | ✅ |
| Autosave and crash recovery | ✅ | — | ✅ |
| Project templates | ✅ | ✅ | — |
| Real-time collaboration, comments | ✅ | — | — |
| Embed postMessage API | ✅ | — | ✅ |
| Offline areas / PWA install | ✅ | ✅ | ◐ (engine cached) |

### Automation, AI and platforms

| Feature | GeoLibre | RustGIS | QuarkGIS |
| --- | --- | --- | --- |
| AI assistant (natural language to actions) | ✅ | ✅ | — |
| MCP server for AI agents | ✅ | ✅ | — |
| Python package / Jupyter widget | ✅ | ✅ | — |
| R package | ✅ | — | — |
| CLI | — | ✅ | — |
| Plugin system and registry | ✅ | ✅ (sandboxed WASM) | — |
| Desktop apps | ✅ (Tauri) | ✅ (native) | — (open question: Tauri) |
| Native mobile apps | ✅ (iOS, Android) | — | — |
| Chrome extension | ✅ | — | — |
| Self-hosting (Docker, server API, accounts) | ✅ | — | — |

## Part 2. What's worth adding

Judged against the PRD: QGIS fidelity and round-trip first, the everyday 80%, simple UI, everything client-side, and its non-goals (no full Desktop UI, no PyQGIS, no PostGIS, no print layouts in v1, no mobile editing). Features that can be stored in the project file, so Desktop sees them too, rank higher.

### Worth adding

Small to medium effort, used daily, and most of them fit the existing design. **All 20 are implemented** (October 2026; see the README).

| # | Feature | Why | Effort |
| --- | --- | --- | --- |
| 1 | **Undo/redo for all project changes** (style, tree, layers) | Every edit already goes through the XML document, so undo is a stack of snapshots. Both apps have it. | S |
| 2 | **Export map image** (PNG at chosen DPI/size) | The most common "get it out" task, missing today. The engine renders at any size. | S |
| 3 | **Measure distance and area** | Basic GIS expectation; geodesic measurement in the browser. | S |
| 4 | **Spatial bookmarks** | QGIS stores bookmarks in the project, so they round-trip to Desktop. | S |
| 5 | **Place search and go to coordinate** | Fast navigation; geocoding needs a provider (Nominatim) and a privacy note. | S |
| 6 | **Feature selection** (click, rectangle; select by expression and location), synced with the attribute table | Core interaction that several features build on (zoom to selection, export selection, edit selection). | M |
| 7 | **Field calculator, add/delete fields** | Everyday data work. Expressions evaluated by QGIS, written with SQLite to GeoPackage, as editing already does. | M |
| 8 | **Export layer** (GeoJSON, GeoPackage, CSV, optionally Shapefile/FlatGeobuf) | Users need data out, not only projects. GeoPackage writing exists already. | M |
| 9 | **Map tips / popup configuration** | QGIS stores map tips and display expressions in the project; the engine already evaluates `[% %]` templates. Round-trips. | S |
| 10 | **Copy/paste style between layers** | Common and cheap: copy the QML in memory. | S |
| 11 | **CSV/Excel with coordinates** | Very common input. Test what the engine's GDAL reads first (CSV open options, XLSX driver). | S–M |
| 12 | **Rule-based renderer and heatmap/cluster forms** | QGIS renderers that are saved in the project; today only through the QML editor. | M |
| 13 | **Raster styling forms** (singleband pseudocolor, hillshade, stretch) | Rasters load but can only be styled through QML. | M |
| 14 | **Autosave and crash recovery** | OPFS snapshots of the document; protects edits. | S–M |
| 15 | **Snapping to other layers, plus merge/split** | Makes editing practical. | M |
| 16 | **Dark mode** | Expected in a modern app; CSS variables already exist. | S |
| 17 | **Attribute forms from the project** (QGIS edit widgets: value maps, ranges, constraints) | QGIS saves forms in the project; honoring them makes editing match Desktop. | M |
| 18 | **On-map legend** | The engine renders the QGIS legend as an image. Useful for map-only embeds. | S |
| 19 | **Swipe / side-by-side compare** | Popular, contained; reuses the layer stack. | M |
| 20 | **Embed postMessage API** | The PRD's developer use case ("embed a map-only view"); lets a host page drive the map. | M |

### Maybe later

Valuable, but larger, dependent on outside services, or outside the current PRD milestones.

| Feature | Why later | Effort |
| --- | --- | --- |
| Translations (i18n) | Worth it for QGIS's international audience; better once the UI settles. | M |
| PMTiles, MBTiles, OGC API Features, ArcGIS REST, STAC | Popular sources; each a contained addition to the remote-layer code. | M each |
| Time slider (QGIS temporal controller) | QGIS stores temporal settings in the project; needs engine support for time filtering. | L |
| More processing: union, spatial join, merge, raster tools | Extend the toolbox as users ask; raster tools need a raster engine (or GDAL bindings in qgis-js). | M–L |
| Whitebox / GeoLibre WASM toolbox (1,000+ tools) | Big capability jump. Check licensing and bundle size; results wouldn't be "QGIS processing". | L |
| Processing history and model builder | History is small; a model builder that runs QGIS `.model3` files needs the processing framework in qgis-js. | S / L |
| Print layouts and atlas | PRD non-goal for v1; QGIS layouts in the project could later be rendered by the engine if bound upstream. | L |
| Elevation profile, line of sight | Needs raster sampling (engine binding or geotiff.js). | M |
| Network analysis, geocoding tools | Depend on external routing and geocoding services. | M |
| Attribute charts and statistics | Nice for exploration; not core to the PRD. | M |
| AI assistant / MCP server | Both apps have one; easy to bolt on (every action is already a command), but needs an API key and a privacy policy. Your call. | M |
| Plugin system | QGIS plugins are Python and won't run; a JS plugin API is a new ecosystem to maintain. | L |
| Desktop app (Tauri) | Already a PRD open question. | M–L |
| Project templates, style library | Convenience; QGIS Hub covers part of it. | S–M |
| Basemap gallery with more providers and previews | Easy polish once remote layers grow. | S |
| Coordinates in DMS/UTM/MGRS, grids | Niche but cheap. | S |
| Topology checks, feature templates | Power-editing features. | M |
| LiDAR / point clouds | QGIS supports point clouds, but qgis-js would need the provider. | L |

### Not needed

Out of scope for the PRD, against its design, or better left to other tools.

| Feature | Why not |
| --- | --- |
| Multiple rendering engines (MapLibre, Mapbox, Cesium, ArcGIS) | QGIS is the renderer; that is the product's point. |
| 3D globe, terrain, 3D Tiles, Gaussian splats | Not available in qgis-js; would bypass QGIS rendering. Revisit if qgis-js gains 3D. |
| Planetary basemaps, weather, sun simulation, Wikipedia cards, flight simulator | Showcase features, not the "everyday 80%" of QGIS users. |
| Dozens of data-catalog plugins (Earth Engine, Planetary Computer, HF, NASA, US portals…) | Large maintenance surface; the QGIS Hub and generic remote layers cover the PRD. |
| Database connections (PostGIS, SQL Server, Iceberg, S3) | PRD non-goal (no direct PostgreSQL); browsers can't reach databases without a server. |
| SQL workspace (DuckDB/PGlite) | Power-user feature; QGIS expressions cover filtering. |
| Python console, Jupyter widget, R package, CLI | PRD non-goal (no PyQGIS); different audience. |
| Real-time collaboration, comments, accounts, self-hosting server | Needs a backend; PRD keeps the app static and private. |
| Story maps, dashboards, reports, presentations | Different product category. |
| Native iOS/Android apps, Chrome extension | PRD: phones get view and identify only; the PWA covers it. |
| Field collection with GPS | PRD non-goal (no mobile editing in v1). |
| AI segmentation, object detection, OBIA, imagery classification | Specialist remote-sensing work; needs models or servers. |
| ArcGIS Pro project import, ArcGIS/SQL Server write-back | Not this product's ecosystem. |
| Ribbon UI, UI profiles, pane sets, workflow manager | PRD: simple shell, few panels, not a Desktop clone. |
| Domains, subtypes, attribute rules, archiving (RustGIS data design) | Esri concepts; QGIS forms and constraints (item 17 above) cover the QGIS side. |

## Where QuarkGIS is ahead

- Exact QGIS rendering of any project, including renderers, symbol layers, labels and expressions that neither app reproduces (rule-based labels, geometry generators, data-defined properties).
- Lossless `.qgs`/`.qgz` round-trip, verified in CI against QGIS Desktop. GeoLibre's QGIS import is lossy and one-way; RustGIS doesn't read QGIS projects.
- QGIS expressions everywhere, evaluated by QGIS itself.
- Processing results that match QGIS Desktop's native algorithms.
- Projects shared without hosting any data (only the project file), with publish checks for local data, CORS and credentials.
