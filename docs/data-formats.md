# Data formats

## Files

| Format | Open | Edit | Export | Notes |
| --- | :-: | :-: | :-: | --- |
| QGIS project (`.qgs`, `.qgz`) | ✅ | ✅ | ✅ | Also projects stored in a GeoPackage |
| GeoPackage (`.gpkg`) | ✅ | ✅ | ✅ | Vector and raster tables; layer picker |
| GeoJSON | ✅ | via GeoPackage | ✅ | |
| Shapefile (`.shp` + sidecars, or `.zip`) | ✅ | via GeoPackage | ✅ (zip) | |
| FlatGeobuf (`.fgb`) | ✅ | via GeoPackage | ✅ | |
| GeoParquet (`.parquet`) | ✅ | via GeoPackage | | |
| KML, GPX, GML | ✅ | via GeoPackage | ✅ (KML) | |
| CSV / TSV / TXT | ✅ | via GeoPackage | ✅ (WKT) | Points from columns or WKT, or a plain table |
| Excel (`.xlsx`) | ✅ | via GeoPackage | | Read as CSV |
| GeoTIFF / COG | ✅ | | | Styling, histogram, pixel values, profiles |
| MBTiles | ✅ | | | Raster and vector tiles, drawn by the browser |

"Via GeoPackage": the layer is converted to a GeoPackage in the project's `data/` folder when you start editing.

## Web services

| Service | Drawn by | Saved as (QGIS provider) |
| --- | --- | --- |
| XYZ tiles | Browser | `wms` (type=xyz) |
| WMS, WMTS | Browser | `wms` |
| WFS | QGIS (downloaded) | `WFS` |
| OGC API Features | QGIS (downloaded) | `OAPIF` |
| OGC API Tiles | Browser | `wms` (xyz) or `vectortile` |
| ArcGIS FeatureServer | QGIS (downloaded) | `arcgisfeatureserver` |
| ArcGIS MapServer, ImageServer | Browser | `arcgismapserver` |
| ArcGIS VectorTileServer | Browser | `vectortile` (arcgis) |
| Vector tiles (MVT) | Browser | `vectortile` |
| PMTiles | Browser | `gdal` / `ogr` (`/vsicurl/`) |
| Cloud Optimized GeoTIFF | Browser | `gdal` (`/vsicurl/`) |
| Vector file by URL | QGIS (downloaded) | `ogr` (`/vsicurl/`) |

"Drawn by the browser" layers are rendered with OpenLayers in their place in the layer tree, because the QGIS engine can't use the network yet. They are saved as regular QGIS layers, so QGIS Desktop opens them natively. Vector tiles drawn by the browser use a default style, and show only in Web Mercator projects.

## Databases and saved logins

A web page can't connect to a database, so **PostGIS**, SQL Server, Oracle, SAP HANA and DB2 layers can't be shown. They are flagged in the layer tree, left out of the map, and kept in the project for QGIS Desktop. To show such data on the web, serve it as a web service and add that: [pg_featureserv](https://github.com/CrunchyData/pg_featureserv) (OGC API Features), [pg_tileserv](https://github.com/CrunchyData/pg_tileserv) (vector tiles) or QGIS Server (WMS/WFS).

Layers using a QGIS **saved login** (`authcfg`) are flagged too: those credentials live in QGIS Desktop's password store. Use a service that doesn't need a login, or one with its key in the URL.

## Coordinate reference systems

Every CRS known to QGIS: definitions are read from QGIS's own `srs.db`. Layers in another CRS than the project are reprojected on the fly, as in Desktop.
