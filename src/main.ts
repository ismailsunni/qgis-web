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
import { ui } from "./lib/state.svelte";

// Scripted access for end-to-end tests (see tests/).
Object.assign(globalThis, { qgisWebApp: { actions, doc, tree, ui, adddata, remote, style, engine, apply, editing, map, publish, gpkg, PointGeometry: Point, settings, storage } });

mount(App, { target: document.getElementById("app")! });
