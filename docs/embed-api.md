# Embed API

A page that embeds QuarkGIS in an iframe can drive the map and listen to it with `postMessage`.

```html
<iframe id="map" src="https://ismailsunni.id/quarkgis/?url=https://example.org/project.qgz&maponly"
        width="800" height="500" allow="cross-origin-isolated"></iframe>
```

The QGIS engine needs a cross-origin isolated page: the host page must be served with
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (or
`credentialless`). Otherwise the frame offers to open the map in its own tab.

## Protocol

Every message is an object with `quarkgis: 1`.

- **Command** (host → map): `{ quarkgis: 1, id, command, args }`
- **Reply** (map → host): `{ quarkgis: 1, id, ok: true, result }` or `{ quarkgis: 1, id, ok: false, error }`
- **Event** (map → host): `{ quarkgis: 1, event, data }`

Only the frame's direct parent can send commands. Events are sent to the origin of the first
command (send `hello` first). A map published with an embed allowlist only answers pages on those
domains. Commands change what is shown, never the saved project.

Layers are referenced by id or by name. Coordinates are WGS 84 longitude/latitude.

## Commands

| Command | Arguments | Result |
| --- | --- | --- |
| `hello` | | `{ version, project, ready }` |
| `getLayers` | | `[{ id, name, visible, opacity, valid }]` |
| `setLayerVisibility` | `{ layer, visible }` | |
| `setLayerOpacity` | `{ layer, opacity }` (0–1) | |
| `getView` | | `{ bbox: [w, s, e, n], scale, crs }` |
| `setView` | `{ center: [lon, lat], scale? , zoom? }` | |
| `fitBounds` | `{ bbox: [w, s, e, n] }` | |
| `zoomToLayer` | `{ layer }` | |
| `zoomToFull` | | |
| `getFeatures` | `{ layer, expression?, limit? }` (QGIS expression, limit ≤ 10,000) | GeoJSON FeatureCollection |
| `selectByExpression` | `{ layer, expression, mode? }` (`new`, `add`, `remove`, `intersect`) | number selected |
| `getSelectedFeatures` | `{ layer }` | GeoJSON FeatureCollection |
| `clearSelection` | | |
| `setFilter` | `{ layer, filter }` (the provider's filter, e.g. an SQL `WHERE` clause for GeoPackage; empty to clear) | |
| `exportImage` | `{ scale?, legend?, title? }` | PNG data URL |
| `openProject` | `{ url }` | |

## Events

| Event | Data |
| --- | --- |
| `projectLoaded` | `{ name, layers: [{ id, name }] }` |
| `viewChanged` | `{ bbox, scale, crs }` |
| `featuresIdentified` | `[{ layer, layerName, id, title, attributes }]` (after a click on the map) |
| `selectionChanged` | `{ layer, ids }` |

## A small client

```js
function connect(frame) {
  let n = 0;
  const pending = new Map();
  const listeners = {};
  addEventListener("message", (e) => {
    if (e.source !== frame.contentWindow || e.data?.quarkgis !== 1) return;
    if (e.data.event) (listeners[e.data.event] ?? []).forEach((fn) => fn(e.data.data));
    else pending.get(e.data.id)?.(e.data), pending.delete(e.data.id);
  });
  const call = (command, args) =>
    new Promise((resolve, reject) => {
      const id = ++n;
      pending.set(id, (r) => (r.ok ? resolve(r.result) : reject(new Error(r.error))));
      frame.contentWindow.postMessage({ quarkgis: 1, id, command, args }, new URL(frame.src).origin);
    });
  const on = (event, fn) => (listeners[event] ??= []).push(fn);
  return { call, on };
}

const map = connect(document.getElementById("map"));
// Wait for the project, then use it.
while (!(await map.call("hello")).ready) await new Promise((r) => setTimeout(r, 1000));
map.on("featuresIdentified", (hits) => console.log(hits));
await map.call("setView", { center: [2.35, 48.85], scale: 5_000_000 });
await map.call("selectByExpression", { layer: "Countries", expression: `"CONTINENT" = 'Europe'` });
```
