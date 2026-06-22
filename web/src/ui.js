// ui.js — entry point. DOM event wiring, live readouts, palette extraction,
// genre presets, file upload, image pan/zoom interactions, and boot. Pure
// geometry lives in kdp.js; pixels in render.js; this module connects controls
// to state and re-renders.

import { S } from "./state.js";
import {
  dims, spineTextAllowed, SPINE_TEXT_MIN_PAGES, BLEED,
  imageRegion, effectiveDPI, dpiSeverity, cmykRisk, DPI_MIN, DPI_FLOOR,
} from "./kdp.js";
import { render, drawCover, getPrevScale, rotateBy } from "./render.js";
import { exportWrap, exportEbook, exportPDF } from "./export.js";
import { ensureFontsLoaded } from "./fonts.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cv = $("preview");

// Single render funnel: redraw the canvas, then refresh the pre-flight notices.
function rerender() {
  render();
  updateNotices();
}

/* ---------- pre-flight notices (effective DPI + CMYK gamut) ---------- */
function setNotice(el, severity, html) {
  el.className = "notice" + (severity ? " " + severity : "");
  if (html == null) return;
  el.classList.add("show");
  el.innerHTML = html;
}
function updateNotices() {
  // Effective DPI of the placed background image (invariant: native px / placed in).
  const dn = $("dpiNote");
  if (S.img) {
    const d = dims(S);
    const r = imageRegion(d, S.fit);
    const dpi = Math.round(effectiveDPI({ imgW: S.img.width, imgH: S.img.height, regionWin: r.w, regionHin: r.h, zoom: S.imgScale }));
    const sev = dpiSeverity(dpi);
    const msg = sev === "ok"
      ? `Effective resolution <b>${dpi}</b> DPI — at or above the ${DPI_MIN} DPI print minimum.`
      : sev === "warn"
        ? `Effective resolution <b>${dpi}</b> DPI — below the ${DPI_MIN} DPI minimum; may look soft in print. Use a larger image or zoom out.`
        : `Effective resolution <b>${dpi}</b> DPI — below ${DPI_FLOOR} DPI; will print blurry. Use a much larger image.`;
    setNotice(dn, sev, msg);
  } else {
    setNotice(dn, "", null);
    dn.classList.remove("show");
  }

  // CMYK gamut risk across the cover's colors.
  const cn = $("cmykNote");
  const labels = [["title", S.title.color], ["author", S.author.color], ["spine", S.spine.color], ["back text", S.back.color], ["base color", S.bg]];
  const risky = labels.filter(([, hex]) => cmykRisk(hex)).map(([name]) => name);
  if (risky.length) {
    setNotice(cn, "warn",
      `Saturated color${risky.length > 1 ? "s" : ""} (<b>${risky.join(", ")}</b>) may shift noticeably converting RGB→CMYK on press. Consider muting, and order a proof.`);
    $("preflightOk").style.display = "none";
  } else {
    setNotice(cn, "", null);
    cn.classList.remove("show");
    $("preflightOk").style.display = "block";
  }
}

/* ---------- readouts ---------- */
function updateReadout() {
  const d = dims(S);
  $("oSpine").innerHTML = d.spine.toFixed(4) + ' <small>in</small>';
  $("oFull").innerHTML = d.fullW.toFixed(3) + ' × ' + d.fullH.toFixed(3) + ' <small>in</small>';
  $("oPx").textContent = d.pxW + ' × ' + d.pxH;
  const ok = spineTextAllowed(S.pages);
  $("oSpineText").innerHTML = ok
    ? '<span style="color:var(--ok)">allowed</span>'
    : '<span style="color:var(--danger)">too thin</span>';
  const w = $("spineWarn");
  if (!ok) {
    w.classList.add("show");
    w.textContent = "At " + S.pages + " pages the spine is too narrow for reliable text. KDP wants ~" +
      SPINE_TEXT_MIN_PAGES + "+ pages before spine text prints cleanly — keep the spine blank or solid below that.";
  } else w.classList.remove("show");
}

/* ---------- genre suggestions ---------- */
const GENRE = {
  theology: { tFont: "Cormorant Garamond", aFont: "EB Garamond", tColor: "#f4efe3", aColor: "#c6a75e" },
  literary: { tFont: "Playfair Display", aFont: "Cormorant Garamond", tColor: "#f4efe3", aColor: "#d9c9a3" },
  thriller: { tFont: "Oswald", aFont: "Montserrat", tColor: "#ffffff", aColor: "#e34b4b" },
  romance: { tFont: "Cormorant Garamond", aFont: "Montserrat", tColor: "#fff0f3", aColor: "#e6a4b4" },
  scifi: { tFont: "Archivo Black", aFont: "Oswald", tColor: "#dffbff", aColor: "#56c6e0" },
  nonfic: { tFont: "Montserrat", aFont: "Montserrat", tColor: "#ffffff", aColor: "#f0a830" },
  academic: { tFont: "Libre Baskerville", aFont: "EB Garamond", tColor: "#f4efe3", aColor: "#b9a36a" },
};

/* ---------- palette extraction (simple bucket quantize) ---------- */
function extractPalette(img) {
  const c = document.createElement("canvas"), n = 64; c.width = n; c.height = n;
  const x = c.getContext("2d"); x.drawImage(img, 0, 0, n, n);
  const d = x.getImageData(0, 0, n, n).data, map = {};
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const r = d[i] >> 4, g = d[i + 1] >> 4, b = d[i + 2] >> 4, key = (r << 8) | (g << 4) | b;
    map[key] = (map[key] || 0) + 1;
  }
  const top = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => {
    k = +k; const r = ((k >> 8) & 15) * 17, g = ((k >> 4) & 15) * 17, b = (k & 15) * 17;
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  });
  S.palette = top; renderSwatches();
}
function renderSwatches() {
  const wrap = $("palette"), host = $("swatches"); host.innerHTML = "";
  if (!S.palette.length) { wrap.style.display = "none"; return; }
  wrap.style.display = "block";
  S.palette.forEach((hex) => {
    const s = document.createElement("div"); s.className = "sw"; s.style.background = hex;
    s.title = hex + " — click for title color";
    s.onclick = () => { S.title.color = hex; $("tColor").value = hex; $("tColorL").textContent = hex; rerender(); };
    host.appendChild(s);
  });
}

/* ---------- generic control binders ---------- */
function bindSlider(id, labelId, obj, key, fmt) {
  const el = $(id);
  const sync = () => { obj[key] = +el.value; if (labelId) $(labelId).textContent = (fmt ? fmt(el.value) : el.value); rerender(); };
  el.addEventListener("input", sync); sync();
}
function bindColor(id, labelId, obj, key) {
  const el = $(id), lab = $(labelId);
  el.addEventListener("input", () => { obj[key] = el.value; lab.textContent = el.value; rerender(); });
}

/* ---------- book spec ---------- */
$("trim").addEventListener("change", (e) => {
  if (e.target.value === "custom") { $("customWrap").style.display = "flex"; }
  else { $("customWrap").style.display = "none"; const [w, h] = e.target.value.split(",").map(Number); S.trimW = w; S.trimH = h; }
  updateReadout(); rerender();
});
$("cw").addEventListener("input", (e) => { S.trimW = +e.target.value; updateReadout(); rerender(); });
$("ch").addEventListener("input", (e) => { S.trimH = +e.target.value; updateReadout(); rerender(); });
$("pages").addEventListener("input", (e) => { S.pages = +e.target.value || 24; updateReadout(); rerender(); });
$("paper").addEventListener("change", (e) => { S.paper = +e.target.value; updateReadout(); rerender(); });

/* ---------- title ---------- */
$("tTitle").addEventListener("input", (e) => { S.title.text = e.target.value; rerender(); });
$("tFont").addEventListener("change", (e) => { S.title.font = e.target.value; rerender(); });
$("tShadow").addEventListener("change", (e) => { S.title.shadow = e.target.checked; rerender(); });
bindSlider("tSize", "tSizeL", S.title, "size", (v) => v + " pt");
bindSlider("tY", "tYL", S.title, "y", (v) => v + "%");
bindColor("tColor", "tColorL", S.title, "color");

/* ---------- author ---------- */
$("aText").addEventListener("input", (e) => { S.author.text = e.target.value; rerender(); });
$("aFont").addEventListener("change", (e) => { S.author.font = e.target.value; rerender(); });
bindSlider("aSize", "aSizeL", S.author, "size", (v) => v + " pt");
bindSlider("aY", "aYL", S.author, "y", (v) => v + "%");
bindColor("aColor", "aColorL", S.author, "color");

/* ---------- spine ---------- */
$("sText").addEventListener("input", (e) => { S.spine.text = e.target.value; rerender(); });
bindColor("sColor", "sColorL", S.spine, "color");
$("sFlip").addEventListener("change", (e) => { S.spine.flip = e.target.checked; rerender(); });

/* ---------- background fill (solid / gradient) ---------- */
document.querySelectorAll("#bgModeSeg button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("#bgModeSeg button").forEach((x) => x.classList.remove("on")); b.classList.add("on");
  S.bgMode = b.dataset.bg;
  $("solidWrap").style.display = S.bgMode === "solid" ? "block" : "none";
  $("gradWrap").style.display = S.bgMode === "gradient" ? "block" : "none";
  rerender();
}));
bindColor("bgColor", "bgColorL", S, "bg");
bindColor("gradFrom", "gradFromL", S.gradient, "from");
bindColor("gradTo", "gradToL", S.gradient, "to");
$("gradAngle").addEventListener("input", (e) => { S.gradient.angle = +e.target.value; $("gradAngleL").textContent = e.target.value + "°"; rerender(); });

/* ---------- image opacity + blend ---------- */
$("opacity").addEventListener("input", (e) => { S.imgOpacity = +e.target.value / 100; $("opL").textContent = e.target.value + "%"; rerender(); });
$("opL").textContent = "100%";
$("imgBlend").addEventListener("change", (e) => { S.imgBlend = e.target.value; rerender(); });

/* ---------- back cover ---------- */
$("bText").value = S.back.text;
$("bText").addEventListener("input", (e) => { S.back.text = e.target.value; rerender(); });
$("bFont").addEventListener("change", (e) => { S.back.font = e.target.value; rerender(); });
bindSlider("bSize", "bSizeL", S.back, "size", (v) => v + " pt");
bindSlider("bY", "bYL", S.back, "y", (v) => v + "%");
bindColor("bColor", "bColorL", S.back, "color");
document.querySelectorAll("#bAlignSeg button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("#bAlignSeg button").forEach((x) => x.classList.remove("on")); b.classList.add("on");
  S.back.align = b.dataset.align; rerender();
}));

/* ---------- stage controls ---------- */
$("guides").addEventListener("change", (e) => { S.guides = e.target.checked; rerender(); });
document.querySelectorAll("#viewSeg button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("#viewSeg button").forEach((x) => x.classList.remove("on")); b.classList.add("on");
  S.view = b.dataset.view;
  $("view2d").style.display = S.view === "2d" ? "block" : "none";
  $("view3d").style.display = S.view === "3d" ? "block" : "none";
  rerender();
}));
document.querySelectorAll("#fitSeg button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("#fitSeg button").forEach((x) => x.classList.remove("on")); b.classList.add("on");
  S.fit = b.dataset.fit; rerender();
}));
$("zin").onclick = () => { S.zoom = Math.min(6, S.zoom + 1); $("zlabel").textContent = S.zoom ? ("+" + S.zoom) : "fit"; rerender(); };
$("zout").onclick = () => { S.zoom = Math.max(0, S.zoom - 1); $("zlabel").textContent = S.zoom ? ("+" + S.zoom) : "fit"; rerender(); };

/* ---------- genre ---------- */
$("applyGenre").onclick = () => {
  const g = GENRE[$("genre").value]; if (!g) return;
  S.title.font = g.tFont; $("tFont").value = g.tFont;
  S.author.font = g.aFont; $("aFont").value = g.aFont;
  S.title.color = g.tColor; $("tColor").value = g.tColor; $("tColorL").textContent = g.tColor;
  S.author.color = g.aColor; $("aColor").value = g.aColor; $("aColorL").textContent = g.aColor;
  rerender();
};

/* ---------- file upload ---------- */
const drop = $("drop"), file = $("file");
drop.onclick = () => file.click();
file.onchange = (e) => loadImg(e.target.files[0]);
["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.style.borderColor = "var(--brass)"; }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.style.borderColor = ""; }));
drop.addEventListener("drop", (e) => { if (e.dataTransfer.files[0]) loadImg(e.dataTransfer.files[0]); });
function loadImg(f) {
  if (!f) return; const r = new FileReader();
  r.onload = () => {
    const img = new Image();
    img.onload = () => {
      S.img = img; $("thumb").classList.add("show"); $("thumbImg").src = img.src;
      S.imgScale = 1; S.imgX = 0; S.imgY = 0; $("scale").value = 100; $("scaleL").textContent = "100%";
      cv.style.cursor = "grab";
      extractPalette(img); rerender();
    };
    img.src = r.result;
  };
  r.readAsDataURL(f);
}

/* ---------- export ---------- */
$("expWrap").onclick = exportWrap;
$("expEbook").onclick = exportEbook;
$("expPdf").onclick = async () => {
  const btn = $("expPdf"), st = $("pdfStatus"), cmyk = $("pdfCmyk").checked;
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Generating PDF…";
  st.classList.remove("show");
  try {
    const { cmykMode } = await exportPDF({ cmyk });
    let msg = "Print PDF downloaded.";
    if (cmyk && cmykMode === "naive") msg += " CMYK used a built-in conversion (no ICC profile on the server) — order a proof before a print run.";
    else if (cmyk && cmykMode === "icc") msg += " CMYK converted with the server's ICC profile.";
    setNotice(st, "ok", msg);
  } catch (e) {
    setNotice(st, "bad", `PDF export failed: ${e.message}. The PNG wrap above still works fully offline — the PDF needs the Cover Forge API running (see <span class="mono">server/</span>).`);
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
};

/* ---------- image size + position: slider, reset, drag to pan, scroll to zoom ---------- */
$("scale").addEventListener("input", (e) => { S.imgScale = +e.target.value / 100; $("scaleL").textContent = e.target.value + "%"; rerender(); });
$("imgReset").onclick = () => { S.imgScale = 1; S.imgX = 0; S.imgY = 0; $("scale").value = 100; $("scaleL").textContent = "100%"; rerender(); };

let imgDrag = false, ix, iy;
cv.addEventListener("pointerdown", (e) => { if (!S.img) return; imgDrag = true; ix = e.clientX; iy = e.clientY; cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing"; });
cv.addEventListener("pointermove", (e) => {
  if (!imgDrag) return; const r = cv.getBoundingClientRect();
  S.imgX += (e.clientX - ix) * (cv.width / r.width) / getPrevScale();
  S.imgY += (e.clientY - iy) * (cv.height / r.height) / getPrevScale();
  ix = e.clientX; iy = e.clientY; rerender();
});
cv.addEventListener("pointerup", () => { imgDrag = false; cv.style.cursor = S.img ? "grab" : "default"; });
cv.addEventListener("wheel", (e) => {
  if (!S.img) return; e.preventDefault();
  const r = cv.getBoundingClientRect();
  const sx = cv.width / r.width, sy = cv.height / r.height;
  const px = (e.clientX - r.left) * sx, py = (e.clientY - r.top) * sy, scale = getPrevScale(), d = dims(S);
  let rx, ry, rw, rh;
  if (S.fit === "front") { rx = d.frontX * scale; ry = 0; rw = (S.trimW + BLEED) * scale; rh = d.fullH * scale; }
  else { rx = 0; ry = 0; rw = d.fullW * scale; rh = d.fullH * scale; }
  const ir = S.img.width / S.img.height, br = rw / rh; let bw, bh;
  if (ir > br) { bh = rh; bw = rh * ir; } else { bw = rw; bh = rw / ir; }
  const z0 = S.imgScale;
  const dx0 = rx + (rw - bw * z0) / 2 + S.imgX * scale, dy0 = ry + (rh - bh * z0) / 2 + S.imgY * scale;
  const fx = (px - dx0) / (bw * z0), fy = (py - dy0) / (bh * z0);     // image fraction under cursor
  const z1 = clamp(z0 * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.2, 8);
  S.imgScale = z1;
  S.imgX = (px - fx * bw * z1 - rx - (rw - bw * z1) / 2) / scale;     // keep that fraction under cursor
  S.imgY = (py - fy * bh * z1 - ry - (rh - bh * z1) / 2) / scale;
  $("scale").value = Math.round(z1 * 100); $("scaleL").textContent = Math.round(z1 * 100) + "%";
  rerender();
}, { passive: false });

/* ---------- 3D drag-to-rotate ---------- */
let dragging = false, lastX, lastY;
const book = $("book");
book.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; book.setPointerCapture(e.pointerId); });
book.addEventListener("pointermove", (e) => { if (!dragging) return; rotateBy(e.clientX - lastX, e.clientY - lastY); lastX = e.clientX; lastY = e.clientY; });
book.addEventListener("pointerup", () => { dragging = false; });

/* ---------- boot ---------- */
updateReadout();
ensureFontsLoaded().then(rerender);
window.addEventListener("resize", () => { clearTimeout(window._rt); window._rt = setTimeout(rerender, 120); });
setTimeout(rerender, 300);
