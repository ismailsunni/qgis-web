"""Writes src/data/functions.json: QGIS expression functions for the expression builder.

QT_QPA_PLATFORM=offscreen PYTHONPATH=/usr/share/qgis/python python3 scripts/make_functions.py
"""

import html
import json
import os
import re

from qgis.core import QgsApplication, QgsExpression

app = QgsApplication([], False)
app.initQgis()


def text(fragment):
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", fragment))).strip()


out = []
for f in QgsExpression.Functions():
    name = f.name()
    if name.startswith("_") or f.isDeprecated():
        continue
    help_html = QgsExpression.helpText(name)
    desc = re.search(r'<div class="description">(.*?)</div>', help_html, re.S)
    syntax = re.search(r'<div class="syntax">(.*?)</div>', help_html, re.S)
    example = re.search(r'<div class="examples">(.*?)</div>', help_html, re.S)
    out.append({
        "name": name,
        "group": (f.groups()[0] if f.groups() else "Other").replace("GeometryGroup", "Geometry"),
        "syntax": re.split(r" \[ \] marks| Arguments | Examples ", text(syntax.group(1)))[0] if syntax else name,
        "description": text(desc.group(1)) if desc else "",
        "example": text(example.group(1)).split(" → ")[0][:160] if example else "",
        "params": f.params(),
    })
out.sort(key=lambda f: (f["group"], f["name"]))
path = os.path.join(os.path.dirname(__file__), "..", "src", "data", "functions.json")
with open(path, "w") as fh:
    json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
print(len(out), "functions")
app.exitQgis()
