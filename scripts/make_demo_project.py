"""Build the demo project (public/projects/world) from Natural Earth 1:110m data.

Run with the system QGIS Python, e.g.:
  QT_QPA_PLATFORM=offscreen PYTHONPATH=/usr/share/qgis/python python3 scripts/make_demo_project.py
"""

import os

from qgis.core import (
    QgsApplication,
    QgsCategorizedSymbolRenderer,
    QgsCoordinateReferenceSystem,
    QgsFillSymbol,
    QgsGraduatedSymbolRenderer,
    QgsLineSymbol,
    QgsMarkerSymbol,
    QgsPalLayerSettings,
    QgsProject,
    QgsRendererCategory,
    QgsRendererRange,
    QgsTextBufferSettings,
    QgsTextFormat,
    QgsVectorFileWriter,
    QgsVectorLayer,
    QgsVectorLayerSimpleLabeling,
)
from qgis.PyQt.QtGui import QColor, QFont

NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_{}.geojson"
SOURCES = {
    "countries": "admin_0_countries",
    "rivers": "rivers_lake_centerlines",
    "places": "populated_places_simple",
}
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "projects", "world")
GPKG = os.path.join(OUT, "world.gpkg")

app = QgsApplication([], False)
app.initQgis()
os.makedirs(OUT, exist_ok=True)
if os.path.exists(GPKG):
    os.remove(GPKG)

for i, (name, ne) in enumerate(SOURCES.items()):
    src = QgsVectorLayer(NE.format(ne), name, "ogr")
    assert src.isValid(), ne
    opts = QgsVectorFileWriter.SaveVectorOptions()
    opts.layerName = name
    opts.driverName = "GPKG"
    if i:
        opts.actionOnExistingFile = QgsVectorFileWriter.ActionOnExistingFile.CreateOrOverwriteLayer
    keep = {"countries": ["NAME", "CONTINENT", "POP_EST", "GDP_MD", "ISO_A3"],
            "rivers": ["name", "scalerank"],
            "places": ["name", "adm0name", "pop_max", "scalerank"]}[name]
    opts.attributes = [src.fields().indexOf(f) for f in keep]
    err = QgsVectorFileWriter.writeAsVectorFormatV3(src, GPKG, QgsProject.instance().transformContext(), opts)
    assert err[0] == QgsVectorFileWriter.WriterError.NoError, err

project = QgsProject.instance()
project.setCrs(QgsCoordinateReferenceSystem("EPSG:8857"))  # Equal Earth
project.setTitle("World (Natural Earth 1:110m)")


def layer(name):
    lyr = QgsVectorLayer(f"{GPKG}|layername={name}", name.capitalize(), "ogr")
    assert lyr.isValid(), name
    return lyr


countries = layer("countries")
palette = ["#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3", "#fdb462", "#b3de69", "#fccde5"]
continents = sorted({f["CONTINENT"] for f in countries.getFeatures()})
countries.setRenderer(QgsCategorizedSymbolRenderer("CONTINENT", [
    QgsRendererCategory(c, QgsFillSymbol.createSimple({"color": palette[i % len(palette)], "outline_color": "#ffffff", "outline_width": "0.2"}), c)
    for i, c in enumerate(continents)
]))
countries.setDisplayExpression('"NAME"')

rivers = layer("rivers")
rivers.renderer().setSymbol(QgsLineSymbol.createSimple({"color": "#3a7bd5", "width": "0.4"}))
rivers.setDisplayExpression('"name"')

places = layer("places")
ranges = [(0, 1e6, 1.4, "< 1M"), (1e6, 5e6, 2.2, "1M – 5M"), (5e6, 1e7, 3.0, "5M – 10M"), (1e7, 1e8, 4.0, "> 10M")]
places.setRenderer(QgsGraduatedSymbolRenderer("pop_max", [
    QgsRendererRange(lo, hi, QgsMarkerSymbol.createSimple({"color": "#d7301f", "outline_color": "#ffffff", "outline_width": "0.3", "size": str(size)}), label)
    for lo, hi, size, label in ranges
]))
places.setDisplayExpression('"name"')

fmt = QgsTextFormat()
fmt.setFont(QFont("Open Sans"))
fmt.setSize(8)
buf = QgsTextBufferSettings()
buf.setEnabled(True)
buf.setSize(0.8)
buf.setColor(QColor("white"))
fmt.setBuffer(buf)
pal = QgsPalLayerSettings()
pal.fieldName = '"name"'
pal.isExpression = True
pal.setFormat(fmt)
pal.placement = QgsPalLayerSettings.Placement.OrderedPositionsAroundPoint
places.setLabeling(QgsVectorLayerSimpleLabeling(pal))
places.setLabelsEnabled(True)

project.addMapLayer(countries)
project.addMapLayer(places, False)
project.addMapLayer(rivers, False)
root = project.layerTreeRoot()
root.insertLayer(0, places)
group = root.insertGroup(1, "Physical")
group.addLayer(rivers)

assert project.write(os.path.join(OUT, "world.qgz"))
app.exitQgis()
print("written", os.listdir(OUT))
