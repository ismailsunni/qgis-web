# Projects

QuarkGIS works on QGIS project files. The open project is kept as its QGIS XML: every change you make (styles, layers, tree, bookmarks) is written into it, so what you save is exactly what QGIS Desktop reads.

## Opening

| Source | How |
| --- | --- |
| Project folder | **Open project folder** on the start page, or drop the folder. Data paths relative to the project resolve as in Desktop. |
| Files | **Open files**: the `.qgs` / `.qgz` plus its data files. |
| GeoPackage with a project | Open the `.gpkg`; a project stored in it (*Save to GeoPackage* in Desktop) opens with its data. |
| URL | `?url=https://…/project.qgz`. Data is fetched next to it (needs CORS). |
| Shared link | `?gist=owner/id` opens a published map, see [Sharing](sharing.md). |
| Saved in this browser | Listed on the start page. |
| Demo | **Try the demo** |

Layers whose data can't be found are flagged in the layer tree with a warning icon.

## Saving

The **Save** menu offers:

- **Save in this browser** (++ctrl+s++): the project and its data are kept in the browser's storage and listed on the start page.
- **Download project file (.qgz)**: the project alone, for data that lives elsewhere.
- **Download project with data (.zip)**: everything, ready to unzip and open in Desktop.

Saving also writes the current map view into the project, so Desktop opens at the same place.

Changes are **autosaved** a few seconds after each edit. If the tab is closed before you save, the start page offers to recover them.

## Undo

Every project change (style, layer, tree, settings) can be undone with ++ctrl+z++ and redone with ++ctrl+shift+z++. While a layer is being edited, undo applies to the feature edits; see [Editing](editing.md).

## Project properties

Click the project name in the top bar to change the title and the project CRS. The map is always drawn in the project CRS, as in Desktop; web layers are reprojected to it.

## On launch

**Settings → Open project on launch** chooses what opens when you start the app: the start page, a new project, the most recent project, or a specific project (saved in the browser, or by URL). A link with `?url=` or `?gist=` always opens that project instead. See [Settings](settings.md).
