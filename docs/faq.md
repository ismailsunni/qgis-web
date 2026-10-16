# FAQ

**Is my data uploaded anywhere?**
No. Files are read in your browser; in Chrome and Edge a project opened from your computer is saved back to its own files, elsewhere a copy is kept in the browser's storage. Data leaves the browser only when you open a URL (the request goes to that server) or publish a share link (only the project file goes to GitHub, never local data).

**Will QGIS Desktop open what I save?**
Yes. The project is QGIS's own XML, changed in place; layers, styles, labels, bookmarks and temporal settings are written in QGIS's format. The test suite saves projects and opens them in QGIS Desktop to check.

**Why does a web layer stay blank?**
The service probably doesn't allow cross-origin requests (CORS). The browser can only read services that send `Access-Control-Allow-Origin` headers. A message names the layer that failed.

**Why is the first start slow?**
The QGIS engine is about 20 MB of WebAssembly. It is cached after the first visit.

**Which browsers work?**
Recent desktop Chrome, Edge and Firefox. Safari support depends on its WebAssembly threads support.

**Can I use my own server?**
Yes: `npm run build` produces a static site. The server must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, or keep the bundled service worker that adds them.

**Is this an official QGIS project?**
No. It is an independent open-source project built on qgis-js, which is developed by the QGIS community.
