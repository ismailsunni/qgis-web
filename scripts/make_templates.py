"""Writes the QGIS-generated templates used by the app (src/templates/):

- empty.qgs: starting point for "New project"
- style.xml: default marker/line/fill symbols and label settings for the style editor

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

app.exitQgis()
