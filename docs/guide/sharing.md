# Sharing and embedding

Open **Share** in the top bar.

## Link to a project URL

A project opened from a URL can be shared as is: the dialog gives a link with `?url=`. Anyone opening it loads the same project.

## Publishing a share link

**Publish a share link** stores the project file as a [GitHub gist](https://gist.github.com) and gives a link (`?gist=owner/id`) that anyone can open, with no account.

- **Only the project file is published.** Layers must read their data from the web (XYZ, WMS, WMTS, WFS, OGC API, ArcGIS, vector tiles, PMTiles, COG or files by URL). Layers using local files are listed and block publishing: replace them with remote sources or remove them.
- Remote layers are checked first; services that block cross-origin requests are flagged, since viewers would see errors.
- **Passwords, tokens and API keys are removed** from data sources before publishing.
- Local SVG and image symbols are embedded in the project.
- **Visibility**: unlisted (link only) or public.
- **Opens as**: the full app, the compact app, or the map only.
- **Embedding allowed on**: a list of domains that may embed the map (empty for any).
- **Links open at the current view** (position, visible layers, identified feature) unless you untick it.
- **Versions**: publishing again updates the same link; earlier versions stay listed and can be restored, or opened with `&rev=`.

Publishing needs a GitHub token with the `gist` scope, created once and kept only in this browser. Viewing needs nothing.

## URL parameters

| Parameter | Effect |
| --- | --- |
| `?url=<project.qgz>` | Open a project from the web |
| `?gist=<owner>/<id>[&rev=<version>]` | Open a published map |
| `layout=compact` | Hide the top bar; its actions move to a menu |
| `panels=none` | Start with the panels closed |
| `maponly` | Only the map, for embedding |
| `legend` | Show the legend on the map |
| `#v=<x>,<y>,<scale>&on=<layers>&f=<layer>:<feature>` | Open at a view: center and scale in the project CRS, visible layers by position, the feature to show |

## Embedding

```html
<iframe src="https://ismailsunni.id/quarkgis/?url=https://example.org/project.qgz&maponly"
        width="800" height="500" allow="cross-origin-isolated"></iframe>
```

The QGIS engine uses multithreaded WebAssembly, which needs a cross-origin isolated page: the host page must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`). Otherwise the frame offers to open the map in its own tab.

A host page can drive an embedded map (change the view, toggle layers, query and select features, export an image) and listen to its events with the [embed API](../embed-api.md).
