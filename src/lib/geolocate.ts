import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { circular } from "ol/geom/Polygon";
import { transform } from "ol/proj";
import { Style, Fill, Stroke, Circle } from "ol/style";
import { olMap, overlays, mapProjection } from "./map";
import { ui, toast } from "./state.svelte";
import { t } from "./i18n";

/** "Show my location": the device's position and its accuracy, followed while on. */

const source = new VectorSource();
overlays.push(
  new VectorLayer({
    source,
    zIndex: 1002,
    style: (f) =>
      f.getGeometry()!.getType() === "Point"
        ? new Style({ image: new Circle({ radius: 7, fill: new Fill({ color: "#1a73e8" }), stroke: new Stroke({ color: "white", width: 2.5 }) }) })
        : new Style({ fill: new Fill({ color: "rgba(26,115,232,0.12)" }), stroke: new Stroke({ color: "rgba(26,115,232,0.5)", width: 1 }) }),
  }),
);

let watch: number | null = null;

export function toggleLocation(on = watch === null) {
  if (watch !== null) navigator.geolocation.clearWatch(watch);
  watch = null;
  source.clear();
  ui.locating = on;
  if (!on) return;
  if (!navigator.geolocation) return toast(t("This browser can't tell your location."));
  let first = true;
  watch = navigator.geolocation.watchPosition(
    ({ coords }) => {
      const proj = mapProjection();
      const at = transform([coords.longitude, coords.latitude], "EPSG:4326", proj);
      const area = circular([coords.longitude, coords.latitude], Math.max(coords.accuracy, 1), 48).transform("EPSG:4326", proj);
      source.clear();
      source.addFeatures([new Feature(area), new Feature(new Point(at))]);
      // Zoom to the first fix; afterwards keep the user's view.
      if (first) olMap().getView().fit(area.getExtent(), { maxZoom: 17, padding: [80, 80, 80, 80], duration: 400 });
      first = false;
    },
    (e) => {
      toast(e.code === e.PERMISSION_DENIED ? t("Location access was denied.") : t("Your location isn't available right now."));
      toggleLocation(false);
    },
    { enableHighAccuracy: true },
  );
}
