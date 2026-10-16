# Adding data

Open **Add data** in the left rail, or drop files on the map. New layers go on top of the layer tree; files are copied into the project's `data/` folder, so the project keeps working when saved or downloaded.

## Files

| Format | Notes |
| --- | --- |
| GeoPackage (`.gpkg`) | A picker asks which tables to add when there are several. Editable. |
| GeoJSON, FlatGeobuf, KML, GPX, GML | CRS read from the file. |
| Shapefile | Select the `.shp` with its `.dbf`, `.shx`, `.prj`…, or a `.zip`. |
| GeoParquet | |
| GeoTIFF / COG (`.tif`) | Raster styling, histograms, pixel values, elevation profiles. |
| CSV, TSV, TXT | A dialog asks for the delimiter and the geometry: point coordinates, a WKT column, or none. |
| Excel (`.xlsx`) | Converted to CSV, then as above. |
| MBTiles | Raster or vector tiles. |

See [Data formats](../data-formats.md) for the full table, including what can be edited and exported.

## Basemaps

The **Basemaps** gallery adds a basemap at the bottom of the tree in one click: OpenStreetMap, OSM Humanitarian, CyclOSM, OpenTopoMap and Esri imagery, topographic, street, light and dark gray maps. Credits are shown on the map and in exported images.

## Web layers

**Add a remote layer** connects to a service. Choose the type, paste the URL, and for services with several layers click **Load layers** and pick one.

| Type | URL to paste |
| --- | --- |
| XYZ tiles | A template, e.g. `https://tile.openstreetmap.org/{z}/{x}/{y}.png` |
| WMS / WMTS / WFS | The service URL (the capabilities are read for you) |
| Vector tiles (MVT) | A template ending in `{z}/{x}/{y}.pbf` |
| PMTiles | The `.pmtiles` URL; raster or vector is detected |
| OGC API Features | The landing page; pick a collection |
| OGC API Tiles | A collection URL or a tileset (`…/tiles/WebMercatorQuad`); pick map or vector tiles |
| ArcGIS FeatureServer | `…/FeatureServer` (pick a layer) or `…/FeatureServer/0` |
| ArcGIS MapServer / ImageServer | `…/MapServer` (pick a layer) or `…/ImageServer` |
| ArcGIS VectorTileServer | `…/VectorTileServer` |
| Cloud Optimized GeoTIFF | The `.tif` URL |
| Vector file by URL | FlatGeobuf, GeoJSON, GeoPackage… |

Web layers are saved as regular QGIS layers, so Desktop opens them as it would its own.

!!! info "CORS"
    The browser can only read services that allow cross-origin requests. If a layer stays blank, a message names it; the service has to send `Access-Control-Allow-Origin` headers.

## QGIS Hub

The **QGIS Hub** panel browses [hub.qgis.org](https://hub.qgis.org): apply a style (QML) to the current layer in one click, open projects shared as GeoPackages, or add layer definitions.
