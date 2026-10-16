import { mount } from "svelte";
import "ol/ol.css";
import "./app.css";
import App from "./App.svelte";
import * as actions from "./lib/actions";
import * as doc from "./lib/doc";
import * as tree from "./lib/tree";
import * as adddata from "./lib/adddata";
import * as remote from "./lib/remote";
import * as style from "./lib/style";
import * as engine from "./lib/engine";
import { apply } from "./lib/commit";
import * as editing from "./lib/editing";
import * as map from "./lib/map";
import * as publish from "./lib/publish";
import * as gpkg from "./lib/gpkg";
import Point from "ol/geom/Point";
import * as settings from "./lib/settings";
import * as storage from "./lib/storage";
import * as history from "./lib/history";
import * as maptools from "./lib/maptools";
import * as clipboard from "./lib/clipboard";
import * as bookmarks from "./lib/bookmarks";
import * as selection from "./lib/selection";
import * as exporter from "./lib/export";
import * as autosave from "./lib/autosave";
import * as editops from "./lib/editops";
import * as editmap from "./lib/editmap";
import LineString from "ol/geom/LineString";
import Polygon from "ol/geom/Polygon";
import { ui } from "./lib/state.svelte";

// Scripted access for end-to-end tests (see tests/).
Object.assign(globalThis, { qgisWebApp: { actions, doc, tree, ui, adddata, remote, style, engine, apply, editing, map, publish, gpkg, PointGeometry: Point, settings, storage, history, maptools, clipboard, bookmarks, selection, exporter, autosave, editops, editmap, LineString, Polygon } });

settings.applyTheme();
mount(App, { target: document.getElementById("app")! });
