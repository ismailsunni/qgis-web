import { mount } from "svelte";
import "ol/ol.css";
import "./app.css";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app")! });
