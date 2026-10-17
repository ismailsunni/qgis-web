import { getCenter } from "ol/extent";
import { getPointResolution } from "ol/proj";
import { olMap, mapProjection } from "./map";
import { legendImage, mapCredits, renderMap } from "./maptools";
import { t } from "./i18n";

/**
 * A quick map page (title, map, legend, scale bar, north arrow, credits) as PDF: the common
 * "map for a report" case, not QGIS print layouts. The page is rendered by QGIS as one image.
 */

export const PAGES = { A4: [210, 297], A3: [297, 420], Letter: [215.9, 279.4] } as const;
export interface PageOptions { page: keyof typeof PAGES; landscape: boolean; dpi: number; title: string; legend: boolean; scaleBar: boolean; north: boolean }

const MARGIN = 10;

export async function exportPdf(o: PageOptions) {
  const [pw, ph] = o.landscape ? [PAGES[o.page][1], PAGES[o.page][0]] : PAGES[o.page];
  const px = (mm: number) => Math.round((mm / 25.4) * o.dpi);
  const scale = o.dpi / 96;
  const canvas = Object.assign(document.createElement("canvas"), { width: px(pw), height: px(ph) });
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const font = (mm: number, weight = 400) => (ctx.font = `${weight} ${px(mm)}px system-ui, sans-serif`);

  // Title, then the map frame filling the page down to the footer.
  let top = MARGIN;
  if (o.title) {
    font(6, 600);
    ctx.fillStyle = "#1f2421";
    ctx.fillText(o.title, px(MARGIN), px(top + 6));
    top += 11;
  }
  const frame = { x: MARGIN, y: top, w: pw - 2 * MARGIN, h: ph - top - MARGIN - 6 };
  const [W, H] = [px(frame.w), px(frame.h)];

  // The current view, fitted into the frame around the same center.
  const view = olMap().getView();
  const visible = view.calculateExtent(olMap().getSize());
  const res = Math.max((visible[2] - visible[0]) / W, (visible[3] - visible[1]) / H);
  const [cx, cy] = getCenter(visible);
  const extent = [cx - (W / 2) * res, cy - (H / 2) * res, cx + (W / 2) * res, cy + (H / 2) * res];
  ctx.drawImage(await renderMap(extent, W, H, scale), px(frame.x), px(frame.y));
  ctx.strokeStyle = "#555";
  ctx.lineWidth = Math.max(1, px(0.25));
  ctx.strokeRect(px(frame.x), px(frame.y), W, H);

  const box = (x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fillRect(x, y, w, h);
  };
  if (o.legend) {
    const url = legendImage(o.dpi);
    if (url) {
      const img = new Image();
      img.src = url;
      await img.decode();
      const pad = px(2);
      const w = Math.min(img.width, W * 0.4), h = (img.height * w) / img.width;
      const x = px(frame.x) + W - w - pad * 3, y = px(frame.y) + H - h - pad * 3;
      box(x, y, w + pad * 2, h + pad * 2);
      ctx.drawImage(img, x + pad, y + pad, w, h);
    }
  }
  if (o.scaleBar) {
    // Ground metres per pixel at the center (correct for any CRS, including degrees).
    const mPerPx = getPointResolution(mapProjection(), res, [cx, cy], "m");
    const target = (W / 5) * mPerPx;
    const nice = [1, 2, 5].flatMap((m) => [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7].map((p) => m * p)).filter((v) => v <= target).sort((a, b) => b - a)[0] ?? target;
    const len = nice / mPerPx;
    const x = px(frame.x) + px(4), y = px(frame.y) + H - px(8);
    box(x - px(2), y - px(5), len + px(4) + px(18), px(9));
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? "#fff" : "#333";
      ctx.fillRect(x + (len / 4) * i, y, len / 4, px(1.5));
    }
    ctx.strokeStyle = "#333";
    ctx.strokeRect(x, y, len, px(1.5));
    font(2.6);
    ctx.fillStyle = "#222";
    ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, x + len + px(2), y + px(1.6));
    ctx.fillText("0", x - px(0.6), y - px(1));
  }
  if (o.north) {
    const x = px(frame.x) + W - px(10), y = px(frame.y) + px(6);
    box(x - px(4), y - px(2), px(8), px(13));
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + px(2.5), y + px(7));
    ctx.lineTo(x, y + px(5.5));
    ctx.lineTo(x - px(2.5), y + px(7));
    ctx.closePath();
    ctx.fill();
    font(3, 600);
    ctx.textAlign = "center";
    ctx.fillText("N", x, y + px(10.5));
    ctx.textAlign = "start";
  }
  // Footer: credits of the web layers, the date, the scale.
  font(2.4);
  ctx.fillStyle = "#555";
  const scaleText = `1:${Math.round((getPointResolution(mapProjection(), res, [cx, cy], "m") / 0.0254) * o.dpi).toLocaleString()}`;
  ctx.fillText([mapCredits(), `${t("Scale")} ${scaleText}`, new Date().toLocaleDateString(), "QuarkGIS"].filter(Boolean).join("  ·  "), px(MARGIN), px(ph - MARGIN + 1));

  const jpeg = new Uint8Array(await (await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error(t("Export failed")))), "image/jpeg", 0.92))).arrayBuffer());
  return new Blob([pdfWithImage(jpeg, canvas.width, canvas.height, (pw / 25.4) * 72, (ph / 25.4) * 72) as BlobPart], { type: "application/pdf" });
}

/** A one-page PDF holding a JPEG that fills the page. */
export function pdfWithImage(jpeg: Uint8Array, w: number, h: number, pageW: number, pageH: number) {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const b = typeof part === "string" ? enc.encode(part) : part;
    chunks.push(b);
    length += b.length;
  };
  const obj = (n: number, body: string, stream?: Uint8Array) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };
  const content = enc.encode(`q ${pageW.toFixed(2)} 0 0 ${pageH.toFixed(2)} 0 0 cm /Im0 Do Q`);
  push("%PDF-1.4\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  obj(5, `<< /Length ${content.length} >>`, content);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) out.set(c, (at += c.length) - c.length);
  return out;
}
