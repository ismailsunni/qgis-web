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
import { ui } from "./lib/state.svelte";

// Scripted access for end-to-end tests (see tests/).
Object.assign(globalThis, { qgisWebApp: { actions, doc, tree, ui, adddata, remote, style, engine, apply } });

mount(App, { target: document.getElementById("app")! });
