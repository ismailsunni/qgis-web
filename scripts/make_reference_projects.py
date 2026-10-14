"""Builds the reference projects (public/reference/) and QGIS Desktop renders of them
(tests/reference/*.png + manifest.json) used by the render-diff and round-trip tests.

QT_QPA_PLATFORM=offscreen PYTHONPATH=/usr/share/qgis/python python3 scripts/make_reference_projects.py
"""

import json
import os
import shutil

import numpy as np
from osgeo import gdal, osr
from qgis.core import (
    QgsApplication,
    QgsCategorizedSymbolRenderer,
    QgsColorRampShader,
    QgsCoordinateReferenceSystem,
    QgsFillSymbol,
    QgsGraduatedSymbolRenderer,
    QgsLineSymbol,
    QgsMapRendererParallelJob,
    QgsMapSettings,
    QgsMarkerSymbol,
    QgsPalLayerSettings,
    QgsProject,
    QgsRasterLayer,
    QgsRasterShader,
    QgsRectangle,
    QgsRendererCategory,
    QgsRendererRange,
    QgsRuleBasedRenderer,
    QgsSingleBandPseudoColorRenderer,
    QgsSingleSymbolRenderer,
    QgsTextBufferSettings,
    QgsTextFormat,
    QgsVectorFileWriter,
    QgsVectorLayer,
    QgsVectorLayerSimpleLabeling,
    QgsLayerTreeGroup,
)
from qgis.PyQt.QtCore import QSize
from qgis.PyQt.QtGui import QColor, QFont

ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "public", "reference")
RENDERS = os.path.join(ROOT, "tests", "reference")
DATA = os.path.join(OUT, "data")
WORLD = os.path.join(ROOT, "public", "projects", "world", "world.gpkg")
SIZE = (600, 400)

app = QgsApplication([], False)
app.initQgis()
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(DATA)
os.makedirs(RENDERS, exist_ok=True)
shutil.copy(WORLD, os.path.join(DATA, "world.gpkg"))

# Extra formats from the same data: GeoJSON, Shapefile, and a synthetic elevation GeoTIFF.
ctx = QgsProject.instance().transformContext()
for name, driver, ext in [("places", "GeoJSON", "geojson"), ("rivers", "ESRI Shapefile", "shp")]:
    src = QgsVectorLayer(f"{WORLD}|layername={name}", name, "ogr")
    opts = QgsVectorFileWriter.SaveVectorOptions()
    opts.driverName = driver
    QgsVectorFileWriter.writeAsVectorFormatV3(src, os.path.join(DATA, f"{name}.{ext}"), ctx, opts)
y, x = np.mgrid[-90:90:180j, -180:180:360j]
dem = (np.cos(np.radians(x) * 3) * np.cos(np.radians(y) * 2) * 1000 + y * 10).astype("float32")
ds = gdal.GetDriverByName("GTiff").Create(os.path.join(DATA, "elevation.tif"), 360, 180, 1, gdal.GDT_Float32)
ds.SetGeoTransform([-180, 1, 0, 90, 0, -1])
srs = osr.SpatialReference()
srs.ImportFromEPSG(4326)
ds.SetProjection(srs.ExportToWkt())
ds.GetRasterBand(1).WriteArray(dem[::-1])
ds = None


def vector(name, title=None):
    path = {"places_geojson": "data/places.geojson", "rivers_shp": "data/rivers.shp"}.get(name)
    src = os.path.join(OUT, path) if path else f"{os.path.join(DATA, 'world.gpkg')}|layername={name}"
    layer = QgsVectorLayer(src, title or name.capitalize(), "ogr")
    assert layer.isValid(), name
    return layer


def labels(layer, field, size=8):
    fmt = QgsTextFormat()
    fmt.setFont(QFont("DejaVu Sans"))
    fmt.setSize(size)
    buf = QgsTextBufferSettings()
    buf.setEnabled(True)
    buf.setSize(0.7)
    buf.setColor(QColor("white"))
    fmt.setBuffer(buf)
    pal = QgsPalLayerSettings()
    pal.fieldName = field
    pal.setFormat(fmt)
    layer.setLabeling(QgsVectorLayerSimpleLabeling(pal))
    layer.setLabelsEnabled(True)


PALETTE = ["#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3", "#fdb462", "#b3de69", "#fccde5"]


def categorized(layer, field):
    values = sorted({f[field] for f in layer.getFeatures()})
    layer.setRenderer(QgsCategorizedSymbolRenderer(field, [
        QgsRendererCategory(v, QgsFillSymbol.createSimple({"color": PALETTE[i % 8], "outline_color": "#ffffff", "outline_width": "0.2"}), str(v)) for i, v in enumerate(values)
    ]))


def build_categorized(p):
    c = vector("countries"); categorized(c, "CONTINENT"); p.addMapLayer(c)
    return "EPSG:8857"


def build_graduated_3857(p):
    c = vector("countries")
    c.setSubsetString("\"CONTINENT\" <> 'Antarctica'")
    breaks = [0, 5e6, 2e7, 6e7, 2e8, 2e9]
    colors = ["#ffffcc", "#fed976", "#fd8d3c", "#e31a1c", "#800026"]
    c.setRenderer(QgsGraduatedSymbolRenderer("POP_EST", [
        QgsRendererRange(breaks[i], breaks[i + 1], QgsFillSymbol.createSimple({"color": colors[i], "outline_color": "#555555", "outline_width": "0.1"}), f"{breaks[i]}") for i in range(5)
    ]))
    p.addMapLayer(c)
    return "EPSG:3857"


def build_points_4326(p):
    pl = vector("places")
    pl.setRenderer(QgsSingleSymbolRenderer(QgsMarkerSymbol.createSimple({"name": "square", "color": "#2b8cbe", "outline_color": "#000000", "size": "2"})))
    c = vector("countries")
    c.setRenderer(QgsSingleSymbolRenderer(QgsFillSymbol.createSimple({"color": "#eeeeee", "outline_color": "#999999"})))
    p.addMapLayer(pl); p.addMapLayer(c)
    return "EPSG:4326"


def build_rulebased_lines(p):
    r = vector("rivers")
    root = QgsRuleBasedRenderer.Rule(None)
    for expr, color, width in [("\"scalerank\" <= 2", "#08519c", "1.2"), ("\"scalerank\" > 2", "#6baed6", "0.5")]:
        root.appendChild(QgsRuleBasedRenderer.Rule(QgsLineSymbol.createSimple({"color": color, "width": width}), filterExp=expr, label=expr))
    r.setRenderer(QgsRuleBasedRenderer(root))
    c = vector("countries")
    c.setRenderer(QgsSingleSymbolRenderer(QgsFillSymbol.createSimple({"color": "#f7f7f7", "outline_color": "#cccccc"})))
    p.addMapLayer(r); p.addMapLayer(c)
    return "EPSG:8857"


def build_labels(p):
    c = vector("countries"); categorized(c, "CONTINENT"); labels(c, "NAME", 7); p.addMapLayer(c)
    return "EPSG:8857"


def build_raster(p):
    r = QgsRasterLayer(os.path.join(DATA, "elevation.tif"), "Elevation")
    shader = QgsRasterShader()
    ramp = QgsColorRampShader(-2000, 2000)
    ramp.setColorRampItemList([QgsColorRampShader.ColorRampItem(v, QColor(c)) for v, c in [(-2000, "#2c7bb6"), (0, "#ffffbf"), (2000, "#d7191c")]])
    shader.setRasterShaderFunction(ramp)
    r.setRenderer(QgsSingleBandPseudoColorRenderer(r.dataProvider(), 1, shader))
    c = vector("countries")
    c.setRenderer(QgsSingleSymbolRenderer(QgsFillSymbol.createSimple({"style": "no", "outline_color": "#000000", "outline_width": "0.2"})))
    p.addMapLayer(c); p.addMapLayer(r)
    return "EPSG:4326"


def build_formats_group(p):
    pl = vector("places_geojson", "Places (GeoJSON)")
    pl.setRenderer(QgsSingleSymbolRenderer(QgsMarkerSymbol.createSimple({"color": "#e7298a", "size": "1.8"})))
    rv = vector("rivers_shp", "Rivers (Shapefile)")
    rv.setRenderer(QgsSingleSymbolRenderer(QgsLineSymbol.createSimple({"color": "#1f78b4", "width": "0.6"})))
    c = vector("countries")
    c.setRenderer(QgsSingleSymbolRenderer(QgsFillSymbol.createSimple({"color": "#b2df8a", "outline_color": "#33a02c"})))
    c.setOpacity(0.5)
    for l in (pl, rv, c):
        p.addMapLayer(l, False)
    root = p.layerTreeRoot()
    root.addLayer(pl)
    group = root.addGroup("Physical")
    group.addLayer(rv)
    root.addLayer(c)
    return "EPSG:3857"


def build_projected_local(p):
    c = vector("countries")
    c.setRenderer(QgsSingleSymbolRenderer(QgsFillSymbol.createSimple({"color": "#fdd0a2", "outline_color": "#8c2d04", "outline_width": "0.3"})))
    pl = vector("places")
    pl.setRenderer(QgsSingleSymbolRenderer(QgsMarkerSymbol.createSimple({"color": "#000000", "size": "1.5"})))
    p.addMapLayer(pl); p.addMapLayer(c)
    return "EPSG:3035", QgsRectangle(2_500_000, 1_300_000, 6_000_000, 5_500_000)


def build_symbol_layers(p):
    c = vector("countries")
    c.setSubsetString("\"CONTINENT\" = 'South America'")
    sym = QgsFillSymbol.createSimple({"color": "#c6dbef", "outline_style": "no"})
    hatch = QgsFillSymbol.createSimple({}).symbolLayer(0)
    from qgis.core import QgsLinePatternFillSymbolLayer, QgsMarkerLineSymbolLayer
    lp = QgsLinePatternFillSymbolLayer()
    lp.setLineAngle(45)
    lp.setDistance(2)
    lp.setColor(QColor("#3182bd"))
    sym.appendSymbolLayer(lp)
    outline = QgsLineSymbol.createSimple({"color": "#08519c", "width": "0.4", "line_style": "dash"})
    sym.appendSymbolLayer(outline.symbolLayer(0).clone())
    c.setRenderer(QgsSingleSymbolRenderer(sym))
    r = vector("rivers")
    ml = QgsMarkerLineSymbolLayer()
    ml.setInterval(4)
    line = QgsLineSymbol.createSimple({"color": "#de2d26", "width": "0.5"})
    line.appendSymbolLayer(ml)
    r.setRenderer(QgsSingleSymbolRenderer(line))
    p.addMapLayer(r); p.addMapLayer(c)
    return "EPSG:4326", QgsRectangle(-90, -60, -30, 15)


def build_points_labels(p):
    pl = vector("places")
    pl.setSubsetString("\"scalerank\" <= 1")
    pl.setRenderer(QgsSingleSymbolRenderer(QgsMarkerSymbol.createSimple({"color": "#d7301f", "outline_color": "#ffffff", "size": "2.4"})))
    labels(pl, "name", 8)
    c = vector("countries")
    c.setRenderer(QgsSingleSymbolRenderer(QgsFillSymbol.createSimple({"color": "#f0f0f0", "outline_color": "#bdbdbd"})))
    p.addMapLayer(pl); p.addMapLayer(c)
    return "EPSG:3857", QgsRectangle(-2_000_000, 3_500_000, 5_000_000, 8_500_000)


BUILDERS = {
    "categorized": build_categorized,
    "graduated_3857": build_graduated_3857,
    "points_4326": build_points_4326,
    "rulebased_lines": build_rulebased_lines,
    "labels_polygons": build_labels,
    "raster_pseudocolor": build_raster,
    "formats_group_opacity": build_formats_group,
    "projected_laea": build_projected_local,
    "symbol_layers": build_symbol_layers,
    "labels_points": build_points_labels,
}

manifest = []
for name, build in BUILDERS.items():
    project = QgsProject.instance()
    project.clear()
    result = build(project)
    crs, extent = result if isinstance(result, tuple) else (result, None)
    project.setCrs(QgsCoordinateReferenceSystem(crs))
    project.setTitle(name)
    project.setBackgroundColor(QColor("white"))
    folder = os.path.join(OUT, name)
    os.makedirs(folder)
    path = os.path.join(folder, f"{name}.qgz")
    assert project.write(path)
    for leftover in os.listdir(folder):
        if leftover.endswith(("~", "_attachments.zip")):
            os.remove(os.path.join(folder, leftover))

    settings = QgsMapSettings()
    settings.setDestinationCrs(project.crs())
    layers = [l.layer() for l in project.layerTreeRoot().findLayers() if l.isVisible()]
    settings.setLayers(layers)
    if extent is None:
        extent = settings.fullExtent()
        extent.scale(1.05)
    settings.setExtent(extent)
    settings.setOutputSize(QSize(*SIZE))
    settings.setOutputDpi(96)
    settings.setBackgroundColor(QColor("white"))
    # Render as a project would (labeling engine settings, datum transforms), like qgis-js does.
    settings.setLabelingEngineSettings(project.labelingEngineSettings())
    settings.setTransformContext(project.transformContext())
    settings.setEllipsoid(project.ellipsoid())
    job = QgsMapRendererParallelJob(settings)
    job.start()
    job.waitForFinished()
    job.renderedImage().save(os.path.join(RENDERS, f"{name}.png"))
    manifest.append({"name": name, "project": f"reference/{name}/{name}.qgz", "crs": crs, "extent": [extent.xMinimum(), extent.yMinimum(), extent.xMaximum(), extent.yMaximum()], "width": SIZE[0], "height": SIZE[1], "labels": name.startswith("labels")})
    print(name, "ok")

with open(os.path.join(RENDERS, "manifest.json"), "w") as f:
    json.dump(manifest, f, indent=2)
app.exitQgis()
