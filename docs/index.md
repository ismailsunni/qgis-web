---
hide:
  - navigation
---

# QuarkGIS

**Open, edit and share real QGIS projects in your browser, rendered by QGIS itself.**

QuarkGIS runs [QGIS](https://qgis.org) compiled to WebAssembly ([qgis-js](https://github.com/qgis/qgis-js)), so a `.qgs` / `.qgz` project looks the same as in QGIS Desktop: same symbols, same labels, same CRS. There's nothing to install and no server: projects and data stay in your browser.

[Open the app](https://ismailsunni.id/quarkgis/){ .md-button .md-button--primary }
[Get started](getting-started.md){ .md-button }
[Source on GitHub](https://github.com/ismailsunni/quarkgis){ .md-button }

![QuarkGIS with the demo project](assets/screenshots/app.png)

## What it does

<div class="grid cards" markdown>

-   :material-folder-open: **Real QGIS projects**

    ---

    Open `.qgs` / `.qgz` files and project folders, GeoPackages with an embedded project, or a project by URL. Save back to your own files (Chrome, Edge), in the browser, or as a download. Desktop opens what you save, unchanged.

    [:octicons-arrow-right-24: Projects](guide/projects.md)

-   :material-layers: **Local and web data**

    ---

    GeoPackage, GeoJSON, Shapefile, FlatGeobuf, GeoParquet, GeoTIFF, KML, GPX, CSV, Excel and MBTiles. XYZ, WMS, WMTS, WFS, OGC API, ArcGIS REST, vector tiles, PMTiles and COG from the web, and open data catalogs (satellite imagery, elevation, government portals).

    [:octicons-arrow-right-24: Adding data](guide/data.md)

-   :material-palette: **QGIS styling**

    ---

    Clean defaults and one-click suggestions; single, categorized, graduated, rule-based, heatmap and cluster renderers, labels, raster styles, layer properties and joins, QML and styles from the QGIS Hub.

    [:octicons-arrow-right-24: Styling](guide/styling.md)

-   :material-table: **Attributes and selection**

    ---

    A fast attribute table, QGIS expressions with a builder, field calculator, statistics, and selection by click, shape, expression or location.

    [:octicons-arrow-right-24: Attributes](guide/attributes.md)

-   :material-pencil: **Editing**

    ---

    Add, reshape, move, rotate, split, merge and explode features, with snapping, QGIS attribute forms and undo. Edits are written to the GeoPackage.

    [:octicons-arrow-right-24: Editing](guide/editing.md)

-   :material-cog-transfer: **Processing**

    ---

    Buffer, clip, intersection, union, dissolve, join by location and more, with results checked against QGIS Desktop.

    [:octicons-arrow-right-24: Processing](guide/processing.md)

-   :material-map-search: **Map tools**

    ---

    Measure, elevation profiles, time slider, your location, swipe compare, coordinate grid, bookmarks, place search, links to a view, and PNG or PDF export.

    [:octicons-arrow-right-24: Map tools](guide/map.md)

-   :material-share-variant: **Share and embed**

    ---

    Publish a link anyone can open, versioned, with secrets removed. Embed the map in a page and drive it with a small API.

    [:octicons-arrow-right-24: Sharing](guide/sharing.md)

</div>

## Why QuarkGIS

- **What you see is what QGIS draws.** Rendering is done by QGIS core, not re-implemented, so styles and labels match Desktop. Test projects differ from Desktop renders by less than 0.2% of pixels.
- **The project file is the source of truth.** Every change is written into the QGIS project XML, so nothing is lost or converted when you go back to Desktop.
- **Private by default.** Your files are read in the browser. Nothing is uploaded unless you open a URL or publish a link.
- **In your language.** English, German, French, Spanish and Indonesian.

!!! note "Status"
    QuarkGIS is an independent open-source project built on qgis-js. It is not an official QGIS.ORG product. See [how it works](how-it-works.md) for what runs where and the current limitations.
