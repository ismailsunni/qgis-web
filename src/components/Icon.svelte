<script lang="ts">
  const paths = {
    layers: "M12 3 2 8l10 5 10-5-10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5",
    add: "M12 5v14M5 12h14",
    style: "M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5S13.5 15 15 15h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8ZM7.5 11.5h0M10 7.5h0M15 7.5h0",
    table: "M3 5h18v14H3zM3 10h18M3 15h18M9 10v9",
    tools: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4 2.5-2.5Z",
    hub: "M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 0v20M3 7l9 5 9-5",
    close: "M6 6l12 12M18 6 6 18",
    search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4",
    zoom: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4-4M8 11h6M11 8v6",
    share: "M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm12 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8.6 13.5l6.8 4M15.4 6.5l-6.8 4",
    menu: "M4 6h16M4 12h16M4 18h16",
    chevron: "m9 6 6 6-6 6",
    folder: "M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z",
    file: "M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Zm0 0v5h5",
    link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
    warn: "M12 3 2 20h20L12 3Zm0 6v5m0 3v.5",
  };
  let { name, size = 20 }: { name: keyof typeof paths; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={paths[name]} />
</svg>
