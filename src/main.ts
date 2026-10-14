import { mount } from "svelte";
import "ol/ol.css";
import "./app.css";
import App from "./App.svelte";
import * as actions from "./lib/actions";
import * as doc from "./lib/doc";
import * as tree from "./lib/tree";
import { ui } from "./lib/state.svelte";

// Scripted access for end-to-end tests (see tests/).
Object.assign(globalThis, { qgisWebApp: { actions, doc, tree, ui } });

mount(App, { target: document.getElementById("app")! });
