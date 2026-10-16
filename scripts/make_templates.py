"""Writes the QGIS-generated templates used by the app (src/templates/):

- empty.qgs: starting point for "New project"
- style.xml: default marker/line/fill symbols and label settings for the style editor
- renderers.xml: heatmap, point cluster and rule-based renderers, raster renderers
  (pseudocolor, gray, hillshade, multiband) and a project bookmark, as QGIS writes them

QT_QPA_PLATFORM=offscreen PYTHONPATH=/usr/share/qgis/python python3 scripts/make_templates.py
"""

import os

from qgis.core import (
    QgsApplication,
    QgsCoordinateReferenceSystem,
    QgsFillSymbol,
    QgsLineSymbol,
    QgsMarkerSymbol,
    QgsPalLayerSettings,
    QgsProject,
    QgsReadWriteContext,
    QgsSymbolLayerUtils,
    QgsTextBufferSettings,
    QgsTextFormat,
    QgsVectorLayerSimpleLabeling,
)
from qgis.PyQt.QtGui import QColor, QFont
from qgis.PyQt.QtXml import QDomDocument

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "templates")

app = QgsApplication([], False)
app.initQgis()

project = QgsProject.instance()
project.setCrs(QgsCoordinateReferenceSystem("EPSG:3857"))
project.setTitle("Untitled")
assert project.write(os.path.join(OUT, "empty.qgs"))
for leftover in ("empty.qgs~", "empty_attachments.zip"):
    if os.path.exists(os.path.join(OUT, leftover)):
        os.remove(os.path.join(OUT, leftover))

doc = QDomDocument()
root = doc.createElement("templates")
doc.appendChild(root)
ctx = QgsReadWriteContext()
for kind, symbol in [
    ("marker", QgsMarkerSymbol.createSimple({"color": "#3a7bd5", "outline_color": "#ffffff", "outline_width": "0.4", "size": "2.6"})),
    ("line", QgsLineSymbol.createSimple({"color": "#3a7bd5", "width": "0.6"})),
    ("fill", QgsFillSymbol.createSimple({"color": "#a6cee3", "outline_color": "#4d4d4d", "outline_width": "0.26"})),
]:
    root.appendChild(QgsSymbolLayerUtils.saveSymbol(kind, symbol, doc, ctx))

fmt = QgsTextFormat()
fmt.setFont(QFont("Open Sans"))
fmt.setSize(9)
buf = QgsTextBufferSettings()
buf.setEnabled(True)
buf.setSize(0.8)
buf.setColor(QColor("white"))
fmt.setBuffer(buf)
pal = QgsPalLayerSettings()
pal.fieldName = "name"
pal.setFormat(fmt)
root.appendChild(QgsVectorLayerSimpleLabeling(pal).save(doc, ctx))
with open(os.path.join(OUT, "style.xml"), "w") as f:
    f.write(doc.toString(2))

# Renderers and other project elements, written by QGIS from real layers.
import numpy as np
from osgeo import gdal, osr
from qgis.core import (
    QgsBookmark,
    QgsColorRampShader,
    QgsGradientColorRamp,
    QgsHeatmapRenderer,
    QgsHillshadeRenderer,
    QgsMultiBandColorRenderer,
    QgsPointClusterRenderer,
    QgsRasterLayer,
    QgsRasterShader,
    QgsReferencedRectangle,
    QgsRectangle,
    QgsRuleBasedRenderer,
    QgsSingleBandGrayRenderer,
    QgsSingleBandPseudoColorRenderer,
    QgsSingleSymbolRenderer,
    QgsVectorLayer,
)

tmp = "/tmp/quarkgis_template.tif"
ds = gdal.GetDriverByName("GTiff").Create(tmp, 4, 4, 3, gdal.GDT_Float32)
ds.SetGeoTransform([0, 1, 0, 4, 0, -1])
srs = osr.SpatialReference()
srs.ImportFromEPSG(4326)
ds.SetProjection(srs.ExportToWkt())
for b in range(3):
    ds.GetRasterBand(b + 1).WriteArray(np.arange(16, dtype="float32").reshape(4, 4))
ds = None
raster = QgsRasterLayer(tmp, "r")
points = QgsVectorLayer("Point?crs=EPSG:4326", "p", "memory")

doc2 = QDomDocument()
root2 = doc2.createElement("templates")
doc2.appendChild(root2)

heat = QgsHeatmapRenderer()
heat.setRadius(10)
heat.setColorRamp(QgsGradientColorRamp(QColor("#ffffff00"), QColor("#d7191c")))
cluster = QgsPointClusterRenderer()
cluster.setEmbeddedRenderer(QgsSingleSymbolRenderer(QgsMarkerSymbol.createSimple({"color": "#3a7bd5"})))
root_rule = QgsRuleBasedRenderer.Rule(None)
root_rule.appendChild(QgsRuleBasedRenderer.Rule(QgsMarkerSymbol.createSimple({}), filterExp="TRUE", label="rule"))
for r in (heat, cluster, QgsRuleBasedRenderer(root_rule)):
    root2.appendChild(r.save(doc2, ctx))

shader = QgsRasterShader()
ramp = QgsColorRampShader(0, 1)
ramp.setColorRampItemList([QgsColorRampShader.ColorRampItem(0, QColor("#440154"), "0"), QgsColorRampShader.ColorRampItem(1, QColor("#fde725"), "1")])
shader.setRasterShaderFunction(ramp)
renderers = [
    QgsSingleBandPseudoColorRenderer(raster.dataProvider(), 1, shader),
    QgsSingleBandGrayRenderer(raster.dataProvider(), 1),
    QgsHillshadeRenderer(raster.dataProvider(), 1, 315, 45),
    QgsMultiBandColorRenderer(raster.dataProvider(), 1, 2, 3),
]
for r in renderers:
    raster.setRenderer(r.clone())
    raster.renderer().writeXml(doc2, root2)

project.clear()
project.setCrs(QgsCoordinateReferenceSystem("EPSG:4326"))
project.bookmarkManager().addBookmark(QgsBookmark())
bm = QgsBookmark()
bm.setName("Bookmark")
bm.setGroup("")
bm.setExtent(QgsReferencedRectangle(QgsRectangle(0, 0, 10, 10), QgsCoordinateReferenceSystem("EPSG:4326")))
project.bookmarkManager().clear()
project.bookmarkManager().addBookmark(bm)
root2.appendChild(project.bookmarkManager().writeXml(doc2))

with open(os.path.join(OUT, "renderers.xml"), "w") as f:
    f.write(doc2.toString(2))
os.remove(tmp)

app.exitQgis()
