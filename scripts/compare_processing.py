"""Compares QGIS Web processing outputs with QGIS Desktop's native algorithms.

QT_QPA_PLATFORM=offscreen PYTHONPATH=/usr/share/qgis/python:/usr/share/qgis/python/plugins \\
  python3 scripts/compare_processing.py <processing.gpkg> <world.gpkg>

For each output table it runs the same algorithm in QGIS and compares feature count, total
area/length and the Hausdorff distance between the results (relative to their size).
Exits non-zero on mismatch.
"""

import sys

from qgis.core import QgsApplication, QgsCoordinateReferenceSystem, QgsFeatureRequest, QgsGeometry, QgsProcessingContext, QgsVectorLayer

app = QgsApplication([], False)
app.initQgis()
import processing  # noqa: E402
from processing.core.Processing import Processing  # noqa: E402

Processing.initialize()
# QGIS Web, like GEOS, doesn't pre-validate geometries: compare without Desktop's validity check.
context = QgsProcessingContext()
context.setInvalidGeometryCheck(QgsFeatureRequest.InvalidGeometryCheck.GeometryNoCheck)

web, world = sys.argv[1], sys.argv[2]
src = {n: f"{world}|layername={n}" for n in ("countries", "places", "rivers")}
africa = processing.run("native:extractbyexpression", {"INPUT": src["countries"], "EXPRESSION": "\"CONTINENT\" = 'Africa'", "OUTPUT": "memory:"}, context=context)["OUTPUT"]

CASES = {
    "buffer_places": ("native:buffer", {"INPUT": src["places"], "DISTANCE": 2, "SEGMENTS": 5, "END_CAP_STYLE": 0, "JOIN_STYLE": 0, "MITER_LIMIT": 2, "DISSOLVE": False}),
    "dissolve_countries": ("native:dissolve", {"INPUT": src["countries"], "FIELD": ["CONTINENT"]}),
    "extractbyexpression_countries": ("native:extractbyexpression", {"INPUT": src["countries"], "EXPRESSION": "\"CONTINENT\" = 'Africa'"}),
    "intersection_rivers": ("native:intersection", {"INPUT": src["rivers"], "OVERLAY": africa}),
    "clip_places": ("native:clip", {"INPUT": src["places"], "OVERLAY": africa}),
    "centroids_countries": ("native:centroids", {"INPUT": src["countries"]}),
    "reprojectlayer_rivers": ("native:reprojectlayer", {"INPUT": src["rivers"], "TARGET_CRS": QgsCoordinateReferenceSystem("EPSG:3857")}),
}


def measure(layer):
    total = sum((f.geometry().area() or f.geometry().length()) for f in layer.getFeatures())
    union = QgsGeometry.unaryUnion([f.geometry() for f in layer.getFeatures()])
    return layer.featureCount(), total, union


ok = True
for table, (alg, params) in CASES.items():
    web_layer = QgsVectorLayer(f"{web}|layername={table}", table, "ogr")
    if not web_layer.isValid():
        print(f"SKIP {table}: not in {web}")
        continue
    desktop = processing.run(alg, {**params, "OUTPUT": "memory:"}, context=context)["OUTPUT"]
    (n1, t1, u1), (n2, t2, u2) = measure(web_layer), measure(desktop)
    scale = max(abs(t2), 1e-12)
    box = u2.boundingBox()
    diff_ratio = u1.hausdorffDistance(u2) / max(box.width(), box.height(), 1e-12)
    match = n1 == n2 and abs(t1 - t2) / scale < 1e-6 and diff_ratio < 1e-6
    ok &= match
    print(f"{'OK  ' if match else 'DIFF'} {alg:32} web n={n1} desktop n={n2} total rel.diff={abs(t1 - t2) / scale:.2e} geom diff={diff_ratio:.2e}")
app.exitQgis()
sys.exit(0 if ok else 1)
