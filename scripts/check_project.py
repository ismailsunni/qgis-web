"""Opens projects with QGIS Desktop's engine and reports what it sees (round-trip check).

QT_QPA_PLATFORM=offscreen PYTHONPATH=/usr/share/qgis/python python3 scripts/check_project.py out/*.qgz
Prints one JSON object per project; exits non-zero if a project fails to load or has invalid layers.
"""

import json
import sys

from qgis.core import QgsApplication, QgsProject

app = QgsApplication([], False)
app.initQgis()
ok = True
for path in sys.argv[1:]:
    project = QgsProject.instance()
    loaded = project.read(path)
    root = project.layerTreeRoot()
    layers = []
    for node in root.findLayers():
        layer = node.layer()
        info = {"name": node.name(), "visible": node.isVisible(), "valid": bool(layer and layer.isValid())}
        if layer and layer.type() == layer.LayerType.Vector:
            info["renderer"] = layer.renderer().type() if layer.renderer() else None
            info["labels"] = layer.labelsEnabled()
            info["features"] = layer.featureCount()
        if layer:
            info["opacity"] = round(layer.opacity(), 3)
            info["crs"] = layer.crs().authid()
        layers.append(info)
    ok &= loaded and all(l["valid"] for l in layers)
    print(json.dumps({"project": path, "loaded": loaded, "crs": project.crs().authid(), "order": [n.name() for n in root.children()], "layers": layers}))
    project.clear()
app.exitQgis()
sys.exit(0 if ok else 1)
