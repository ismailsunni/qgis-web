"""Writes src/templates/empty.qgs, the starting point for "New project".

QT_QPA_PLATFORM=offscreen PYTHONPATH=/usr/share/qgis/python python3 scripts/make_templates.py
"""

import os

from qgis.core import QgsApplication, QgsCoordinateReferenceSystem, QgsProject

app = QgsApplication([], False)
app.initQgis()
project = QgsProject.instance()
project.setCrs(QgsCoordinateReferenceSystem("EPSG:3857"))
project.setTitle("Untitled")
out = os.path.join(os.path.dirname(__file__), "..", "src", "templates", "empty.qgs")
assert project.write(out)
app.exitQgis()
