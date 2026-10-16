"""Checks projects saved by the round-trip e2e test against their expectations, using QGIS Desktop.

QT_QPA_PLATFORM=offscreen PYTHONPATH=/usr/share/qgis/python python3 scripts/check_roundtrip.py test-results/roundtrip
"""

import json
import os
import sys

from qgis.core import QgsApplication, QgsProject

root = sys.argv[1]
app = QgsApplication([], False)
app.initQgis()
failures = []
for name in sorted(os.listdir(root)):
    expected_path = os.path.join(root, name, "expected.json")
    if not os.path.exists(expected_path):
        continue
    expected = json.load(open(expected_path))
    project = QgsProject.instance()
    project.clear()
    problems = []
    if not project.read(os.path.join(root, name, f"{name}.qgz")):
        problems.append("does not load")
    bookmarks = [b.name() for b in project.bookmarkManager().bookmarks()]
    if bookmarks != expected.get("bookmarks", bookmarks):
        problems.append(f"bookmarks {bookmarks}")
    tree = project.layerTreeRoot()
    order = [n.name() for n in tree.children()]
    if order != expected["order"]:
        problems.append(f"order {order} != {expected['order']}")
    for node in tree.findLayers():
        exp = expected["layers"].get(node.name())
        layer = node.layer()
        if exp is None:
            problems.append(f"unexpected layer {node.name()}")
            continue
        if not layer or not layer.isValid():
            problems.append(f"{node.name()} invalid")
            continue
        if node.isVisible() != exp["visible"]:
            problems.append(f"{node.name()} visible={node.isVisible()}")
        if abs(layer.opacity() - exp["opacity"]) > 0.001:
            problems.append(f"{node.name()} opacity={layer.opacity()}")
        if "renderer" in exp and layer.renderer().type() != exp["renderer"]:
            problems.append(f"{node.name()} renderer={layer.renderer().type()}")
        if exp.get("mapTip") and "[%" not in layer.mapTipTemplate():
            problems.append(f"{node.name()} map tip missing")
        if exp.get("labels") and not layer.labelsEnabled():
            problems.append(f"{node.name()} labels disabled")
        if exp.get("renderer") == "singleSymbol" and layer.renderer().symbol().color().name() != "#ff0000":
            problems.append(f"{node.name()} color={layer.renderer().symbol().color().name()}")
    print(("OK   " if not problems else "FAIL ") + name + ("" if not problems else ": " + "; ".join(problems)))
    failures += problems
app.exitQgis()
sys.exit(1 if failures else 0)
