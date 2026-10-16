# Projects

QuarkGIS works on QGIS project files. The open project is kept as its QGIS XML: every change you make (styles, layers, tree, bookmarks) is written into it, so what you save is exactly what QGIS Desktop reads.

## Opening

| Source | How |
| --- | --- |
| Project folder | **Open project folder** on the start page, or drop the folder. Data paths relative to the project resolve as in Desktop. |
| Project file | **Open project file**: the `.qgs` / `.qgz`, plus its data files if you select them. If layers read files next to the project, the Layers panel offers to open the project folder. |
| GeoPackage with a project | Open the `.gpkg`; a project stored in it (*Save to GeoPackage* in Desktop) opens with its data. |
| URL | `?url=https://…/project.qgz`. Data is fetched next to it (needs CORS). |
| Shared link | `?gist=owner/id` opens a published map, see [Sharing](sharing.md). |
| Saved in this browser | Listed on the start page. |
| Demo | **Try the demo** |

Layers whose data can't be found are flagged with a warning icon; the Layers panel lists the missing files as written in the project (e.g. `../data/world.gpkg`) and helps you give the browser access, like QGIS's *Handle Unavailable Layers*. A web page can't open a path by itself, only inside a folder you allow:

- **Choose the folder with the data…** opens the folder picker at the project. Pick the folder the hint names, e.g. the common parent of the project and `../data/`: the project's paths are followed from there (by file name as a fallback).
- Allowed folders are remembered. Next time, data in them is found without asking, or with one click on **Allow access to “*folder*”** when the browser asks for permission again. This also works for other projects using the same data.
- **More options…** has **Search a folder…** (by file name, in subfolders too) and **Browse…** for one layer's file (for a Shapefile, select its `.dbf`, `.shx` and `.prj` too); layers reading the same file are fixed together.

The project keeps its original paths, so it still opens in QGIS Desktop. For projects opened from your computer in Chrome or Edge, the located files are remembered for the next time, and edits to them are saved back to them.

## Saving

A project opened from your computer in **Chrome or Edge** stays linked to its files. **Save to *folder*** (++ctrl+s++) writes the project file and the data files you changed (edited GeoPackages, new layers in `data/`) back to that folder, as QGIS Desktop does; nothing else is copied. Stopping an edit session saves the same way. Recent linked projects are listed on the start page under *Recent on this computer* and reopen in one click (the browser may ask for permission again).

The **Save** menu also offers:

- **Save in this browser** (++ctrl+s++ for projects that aren't linked), or **Save a copy in this browser**: the project and its data are kept in the browser's storage and listed on the start page.
- **Download project file (.qgz)**: the project alone, for data that lives elsewhere.
- **Download project with data (.zip)**: everything, ready to unzip and open in Desktop.

Saving also writes the current map view into the project, so Desktop opens at the same place.

Changes are **autosaved** in the browser a few seconds after each edit (for linked projects, only the files that changed). If the tab is closed before you save, the start page offers to recover them.

## Undo

Every project change (style, layer, tree, settings) can be undone with ++ctrl+z++ and redone with ++ctrl+shift+z++. While a layer is being edited, undo applies to the feature edits; see [Editing](editing.md).

## Project properties

Click the project name in the top bar to change the title and the project CRS. The map is always drawn in the project CRS, as in Desktop; web layers are reprojected to it.

## On launch

**Settings → Open project on launch** chooses what opens when you start the app: the start page, a new project, the most recent project, or a specific project (saved in the browser, or by URL). A link with `?url=` or `?gist=` always opens that project instead. See [Settings](settings.md).
