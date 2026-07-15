// ui.js — entry point. DOM event wiring, live readouts, palette extraction,
// genre presets, file upload, image pan/zoom interactions, and boot. Pure
// geometry lives in kdp.js; pixels in render.js; this module connects controls
// to state and re-renders.

import {
  S, serialize, restore, resetProject, validateProject,
  AUTOSAVE_KEY, MAX_PROJECT_FILE_BYTES,
} from "./state.js";
import {
  dims, safeArea, spineTextAllowed, SPINE_TEXT_MIN_PAGES, snap,
  imageRegion, effectiveDPI, dpiSeverity, DPI_MIN, DPI_FLOOR,
  HC_PAGE_MIN, HC_PAGE_MAX, normalizeHex,
} from "./kdp.js";
import { render, getPrevScale, rotateBy, pickAt, getHitBox } from "./render.js";
import { isBackBlock, layoutIssues, riskyColorLabels } from "./preflight.js";
import { exportWrap, exportEbook, exportPDF, removeBackground } from "./export.js";
import { ensureFontsLoaded, loadFonts, populateFontSelect } from "./fonts.js";

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cv = $("preview");

// All design-text menus share one curated catalog from fonts.js. Populate them
// before wiring events so the current state remains the selected value.
[
  ["tFont", S.title.font], ["subFont", S.subtitle.font],
  ["aFont", S.author.font], ["serFont", S.series.font],
  ["pqFont", S.pullquote.font], ["bFont", S.back.font],
  ["tagFont", S.tagline.font], ["bioFont", S.bio.font],
].forEach(([id, selected]) => populateFontSelect($(id), selected));

// Single render funnel: redraw the canvas, refresh notices, schedule an autosave.
function rerender() {
  render();
  updateNotices();
  autosave();
  scheduleCommit();
}
// Re-render now (fallback type), then again once the newly-picked face loads.
const loadFontThenRender = (fam) => { loadFonts([fam]).then(rerender); };

/* ---------- autosave to localStorage (restores on reload) ---------- */
let booted = false;        // gate autosave until any boot-restore finishes
let _saveTimer = null;
function autosave() {
  if (!booted) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serialize()));
    } catch (_) {
      // quota (large images) — keep the non-binary design. Overlay metadata is
      // not useful without its embedded src, so omit those layers atomically.
      try {
        const j = serialize(); j.image = null; j.state.overlays = [];
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(j));
      } catch (__) { /* give up */ }
    }
  }, 600);
}

/* ---------- undo / redo (debounced snapshot stack over S) ---------- */
const HISTORY_CAP = 50;
const imgCache = new Map();                 // src -> HTMLImageElement (sync restore)
const cacheImg = (img) => { if (img && img.src) imgCache.set(img.src, img); return img; };
async function cacheLoad(src) {
  if (imgCache.has(src)) return imgCache.get(src);
  const im = await loadImageAsync(src); if (im) imgCache.set(src, im); return im;
}
// Intern data-URL strings so identical images across snapshots share one copy.
const srcPool = new Map();
const intern = (s) => { if (s == null) return s; if (!srcPool.has(s)) srcPool.set(s, s); return srcPool.get(s); };
const srcIds = new Map(); let nextSrcId = 1;
const sourceId = (s) => { if (s == null) return null; if (!srcIds.has(s)) srcIds.set(s, nextSrcId++); return srcIds.get(s); };
function snapshot() {
  const snap = serialize();
  snap.image = intern(snap.image);
  for (const o of snap.state.overlays || []) o.src = intern(o.src);
  return snap;
}
// Cheap change-signature: design state + image identity, excluding binary bulk.
function signature(snap) {
  const st = snap.state;
  const lite = { ...st, overlays: (st.overlays || []).map((o) => ({ ...o, src: sourceId(o.src) })) };
  return JSON.stringify({ s: lite, i: sourceId(snap.image) });
}
const hist = { past: [], future: [], current: null, curSig: "" };
function commitHistory() {
  const snap = snapshot(), sig = signature(snap);
  if (sig === hist.curSig) return;            // nothing meaningful changed
  if (hist.current) { hist.past.push(hist.current); if (hist.past.length > HISTORY_CAP) hist.past.shift(); }
  hist.current = snap; hist.curSig = sig; hist.future = [];
  updateUndoButtons();
}
let _commitTimer = null;
function scheduleCommit() { if (!booted) return; clearTimeout(_commitTimer); _commitTimer = setTimeout(commitHistory, 500); }
function initHistory() { hist.current = snapshot(); hist.curSig = signature(hist.current); hist.past = []; hist.future = []; updateUndoButtons(); }
function updateUndoButtons() { $("undoBtn").disabled = !hist.past.length; $("redoBtn").disabled = !hist.future.length; }

async function applySnapshot(snap) {
  const cloned = JSON.parse(JSON.stringify(snap));
  const imgUrl = restore(cloned);             // deep-merges state into S, returns bg image URL
  S.img = imgUrl ? await cacheLoad(imgUrl) : null;
  if (S.img) { $("thumb").classList.add("show"); $("thumbImg").src = S.img.src; cv.style.cursor = "grab"; }
  else { $("thumb").classList.remove("show"); cv.style.cursor = "default"; }
  for (const ov of S.overlays) { if (ov.src) ov.img = await cacheLoad(ov.src); }
  syncUI();
}
async function undo() {
  if (!hist.past.length) return;
  hist.future.push(hist.current);
  hist.current = hist.past.pop(); hist.curSig = signature(hist.current);
  await applySnapshot(hist.current); updateUndoButtons();
}
async function redo() {
  if (!hist.future.length) return;
  hist.past.push(hist.current);
  hist.current = hist.future.pop(); hist.curSig = signature(hist.current);
  await applySnapshot(hist.current); updateUndoButtons();
}

/* ---------- pre-flight notices (effective DPI + CMYK gamut) ---------- */
function setNotice(el, severity, html) {
  el.className = "notice" + (severity ? " " + severity : "");
  if (html == null) return;
  el.classList.add("show");
  el.innerHTML = html;
}
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

function updateNotices() {
  // Effective DPI of the placed background image (invariant: native px / placed in).
  const dn = $("dpiNote");
  let dpiProblem = false;
  if (S.img) {
    const d = dims(S);
    const r = imageRegion(d, S.fit);
    const dpi = Math.round(effectiveDPI({ imgW: S.img.width, imgH: S.img.height, regionWin: r.w, regionHin: r.h, zoom: S.imgScale }));
    const sev = dpiSeverity(dpi);
    dpiProblem = sev !== "ok";
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
  const risky = riskyColorLabels(S);
  if (risky.length) {
    setNotice(cn, "warn",
      `Saturated color${risky.length > 1 ? "s" : ""} (<b>${risky.join(", ")}</b>) may shift noticeably converting RGB→CMYK on press. Consider muting, and order a proof.`);
  } else {
    setNotice(cn, "", null);
    cn.classList.remove("show");
  }

  const ln = $("layoutNote"), issues = layoutIssues(S, dims(S), getPrevScale(), getHitBox);
  if (issues.length) {
    setNotice(ln, "bad", `Layout check: ${issues.map(escapeHTML).join("; ")}. Reposition the flagged element before export.`);
  } else {
    setNotice(ln, "", null);
    ln.classList.remove("show");
  }
  $("preflightOk").style.display = (!dpiProblem && !risky.length && !issues.length) ? "block" : "none";
}

/* ---------- readouts ---------- */
function updateReadout() {
  const d = dims(S);
  $("oSpine").innerHTML = d.spine.toFixed(4) + ' <small>in</small>';
  $("oFull").innerHTML = d.fullW.toFixed(3) + ' × ' + d.fullH.toFixed(3) + ' <small>in</small>';
  $("oPx").textContent = d.pxW + ' × ' + d.pxH;
  $("oEdge").textContent = d.edge;
  $("oSafe").textContent = d.safe;
  $("oEdgeK").textContent = d.hc ? "Wrap (turn-in)" : "Bleed (each edge)";
  $("geometryNote").textContent = d.hc
    ? "Case wrap = 0.51 + back + spine + front + 0.51 wide, trim + 1.02 tall. Paste KDP's exact case-spine value before export and order a proof."
    : "Wrap = 0.125 + back + spine + front + 0.125 wide, trim + 0.25 tall. Reconcile the final number against KDP's cover calculator and order a proof.";
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
    s.onclick = () => { S.title.color = hex; $("tColor").value = hex; $("tColorL").value = hex; rerender(); };
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
  const el = $(id), hex = $(labelId);
  const markValidity = (valid) => {
    hex.classList.toggle("invalid", !valid);
    hex.setAttribute("aria-invalid", valid ? "false" : "true");
  };
  el.addEventListener("input", () => {
    obj[key] = el.value.toLowerCase();
    hex.value = obj[key];
    markValidity(true);
    rerender();
  });
  hex.addEventListener("input", () => {
    const value = normalizeHex(hex.value);
    markValidity(!!value);
    if (!value) return;
    el.value = value;
    obj[key] = value;
    rerender();
  });
  hex.addEventListener("blur", () => {
    const value = normalizeHex(hex.value);
    hex.value = value || obj[key];
    markValidity(true);
  });
  hex.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); hex.blur(); }
  });
}
// Wire a compact optional text block (text/font/size/color/caps) by id prefix.
function bindTextBlock(prefix, blockKey) {
  const o = S[blockKey];
  $(prefix + "Text").addEventListener("input", (e) => { o.text = e.target.value; rerender(); });
  $(prefix + "Font").addEventListener("change", (e) => { o.font = e.target.value; rerender(); loadFontThenRender(e.target.value); });
  bindSlider(prefix + "Size", prefix + "SizeL", o, "size", (v) => v + " pt");
  bindColor(prefix + "Color", prefix + "ColorL", o, "color");
  $(prefix + "Caps").addEventListener("change", (e) => { o.caps = e.target.checked; rerender(); });
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

// binding: paperback <-> hardcover (swaps geometry, page range, spine field)
function applyBindingUI() {
  const hc = S.binding === "hardcover";
  $("hcWrap").style.display = hc ? "block" : "none";
  const pg = $("pages");
  pg.min = hc ? HC_PAGE_MIN : 24; pg.max = hc ? HC_PAGE_MAX : 828;
  if (hc) S.pages = clamp(S.pages, HC_PAGE_MIN, HC_PAGE_MAX);
  else { S.spineOverride = null; $("spineOver").value = ""; } // spine override is hardcover-only
  pg.value = S.pages;
}
document.querySelectorAll("#bindingSeg button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("#bindingSeg button").forEach((x) => x.classList.remove("on")); b.classList.add("on");
  S.binding = b.dataset.binding;
  applyBindingUI(); updateReadout(); rerender();
}));
$("spineOver").addEventListener("input", (e) => {
  const v = parseFloat(e.target.value);
  S.spineOverride = (v > 0) ? v : null;
  updateReadout(); rerender();
});

/* ---------- title ---------- */
$("tTitle").addEventListener("input", (e) => { S.title.text = e.target.value; rerender(); });
$("tFont").addEventListener("change", (e) => { S.title.font = e.target.value; rerender(); loadFontThenRender(e.target.value); });
bindSlider("tSize", "tSizeL", S.title, "size", (v) => v + " pt");
bindSlider("tY", "tYL", S.title, "y", (v) => v + "%");
bindColor("tColor", "tColorL", S.title, "color");
$("tCaps").addEventListener("change", (e) => { S.title.caps = e.target.checked; rerender(); });
bindSlider("tLs", "tLsL", S.title, "letterSpacing");
bindSlider("tLh", "tLhL", S.title, "lineHeight");
bindColor("tStrokeC", "tStrokeCL", S.title.stroke, "color");
bindSlider("tStrokeW", "tStrokeWL", S.title.stroke, "width", (v) => v + " pt");
const tShadowAdv = () => { $("tShadowAdv").style.display = S.title.shadow ? "block" : "none"; };
$("tShadow").addEventListener("change", (e) => { S.title.shadow = e.target.checked; tShadowAdv(); rerender(); });
tShadowAdv();
bindSlider("tShBlur", "tShBlurL", S.title, "shadowBlur", (v) => v + " pt");
bindSlider("tShDX", "tShDXL", S.title, "shadowDX");
bindSlider("tShDY", "tShDYL", S.title, "shadowDY");
$("tShOp").addEventListener("input", (e) => { S.title.shadowOpacity = +e.target.value / 100; $("tShOpL").textContent = e.target.value + "%"; rerender(); });

/* ---------- author ---------- */
$("aText").addEventListener("input", (e) => { S.author.text = e.target.value; rerender(); });
$("aFont").addEventListener("change", (e) => { S.author.font = e.target.value; rerender(); loadFontThenRender(e.target.value); });
bindSlider("aSize", "aSizeL", S.author, "size", (v) => v + " pt");
bindSlider("aY", "aYL", S.author, "y", (v) => v + "%");
bindColor("aColor", "aColorL", S.author, "color");
$("aCaps").addEventListener("change", (e) => { S.author.caps = e.target.checked; rerender(); });
bindSlider("aLs", "aLsL", S.author, "letterSpacing");
bindColor("aStrokeC", "aStrokeCL", S.author.stroke, "color");
bindSlider("aStrokeW", "aStrokeWL", S.author.stroke, "width", (v) => v + " pt");

/* ---------- optional front blocks: subtitle / series / pull-quote ---------- */
bindTextBlock("sub", "subtitle");
bindTextBlock("ser", "series");
bindTextBlock("pq", "pullquote");
bindTextBlock("tag", "tagline");
bindTextBlock("bio", "bio");

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
$("bFont").addEventListener("change", (e) => { S.back.font = e.target.value; rerender(); loadFontThenRender(e.target.value); });
bindSlider("bSize", "bSizeL", S.back, "size", (v) => v + " pt");
bindSlider("bY", "bYL", S.back, "y", (v) => v + "%");
bindSlider("bLh", "bLhL", S.back, "lineHeight");
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
  S.title.color = g.tColor; $("tColor").value = g.tColor; $("tColorL").value = g.tColor;
  S.author.color = g.aColor; $("aColor").value = g.aColor; $("aColorL").value = g.aColor;
  rerender(); loadFonts([g.tFont, g.aFont]).then(rerender);
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
      S.img = cacheImg(img); $("thumb").classList.add("show"); $("thumbImg").src = img.src;
      S.imgScale = 1; S.imgX = 0; S.imgY = 0; $("scale").value = 100; $("scaleL").textContent = "100%";
      cv.style.cursor = "grab";
      extractPalette(img); rerender();
    };
    img.src = r.result;
  };
  r.readAsDataURL(f);
}

/* ---------- overlay layers ---------- */
const loadImageAsync = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
const newOverlayId = () => "ov_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e4).toString(36);
const selectedOverlay = () => (S.selected && S.selected.startsWith("overlay:")) ? overlayById(S.selected.slice(8)) : null;

async function addOverlayFromSrc(src, widthFrac) {
  const img = await loadImageAsync(src);
  if (!img) return null;
  cacheImg(img);
  const d = dims(S);
  const ov = { id: newOverlayId(), src, img, w: S.trimW * (widthFrac || 0.4), cx: d.frontX + S.trimW / 2, cy: d.fullH * 0.5, opacity: 1, blend: "source-over" };
  S.overlays.push(ov);
  S.selected = "overlay:" + ov.id;
  updateOverlayPanel(); rerender();
  return ov;
}
async function addOverlayFromFile(f) {
  if (!f) return;
  const src = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(f); });
  if (!src || !(await addOverlayFromSrc(src))) setProjStatus("bad", "Could not read that image.");
}

function updateOverlayPanel() {
  const list = $("ovList"); list.innerHTML = "";
  S.overlays.forEach((ov, i) => {
    const row = document.createElement("div");
    row.className = "ovrow" + (S.selected === "overlay:" + ov.id ? " sel" : "");
    const im = document.createElement("img"); im.src = ov.src;
    const lab = document.createElement("span"); lab.textContent = "Layer " + (i + 1);
    row.append(im, lab);
    row.onclick = () => { S.selected = "overlay:" + ov.id; updateOverlayPanel(); rerender(); };
    list.appendChild(row);
  });
  const ov = selectedOverlay();
  $("ovControls").style.display = ov ? "block" : "none";
  $("ovEmpty").style.display = S.overlays.length ? "none" : "block";
  if (ov) {
    const wp = Math.round(ov.w / S.trimW * 100), op = Math.round((ov.opacity ?? 1) * 100);
    $("ovW").value = wp; $("ovWL").textContent = wp + "%";
    $("ovOp").value = op; $("ovOpL").textContent = op + "%";
    $("ovBlend").value = ov.blend || "source-over";
  }
}

$("ovDrop").onclick = () => $("ovFile").click();
$("ovFile").onchange = (e) => { const f = e.target.files[0]; if (f) addOverlayFromFile(f); e.target.value = ""; };
["dragover", "dragenter"].forEach((ev) => $("ovDrop").addEventListener(ev, (e) => { e.preventDefault(); $("ovDrop").style.borderColor = "var(--brass)"; }));
["dragleave", "drop"].forEach((ev) => $("ovDrop").addEventListener(ev, (e) => { e.preventDefault(); $("ovDrop").style.borderColor = ""; }));
$("ovDrop").addEventListener("drop", (e) => { if (e.dataTransfer.files[0]) addOverlayFromFile(e.dataTransfer.files[0]); });
$("ovW").addEventListener("input", (e) => { const ov = selectedOverlay(); if (ov) { ov.w = +e.target.value / 100 * S.trimW; $("ovWL").textContent = e.target.value + "%"; rerender(); } });
$("ovOp").addEventListener("input", (e) => { const ov = selectedOverlay(); if (ov) { ov.opacity = +e.target.value / 100; $("ovOpL").textContent = e.target.value + "%"; rerender(); } });
$("ovBlend").addEventListener("change", (e) => { const ov = selectedOverlay(); if (ov) { ov.blend = e.target.value; rerender(); } });
$("ovDel").onclick = () => { const ov = selectedOverlay(); if (!ov) return; S.overlays = S.overlays.filter((o) => o !== ov); S.selected = null; updateOverlayPanel(); rerender(); };

/* ---------- background removal (server -> overlay layer) ---------- */
$("removeBg").onclick = async () => {
  const btn = $("removeBg"), st = $("bgRemoveStatus");
  if (!S.img) { setNotice(st, "warn", "Load a background image first, then remove its background."); return; }
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Removing background…"; st.classList.remove("show");
  try {
    const cutout = await removeBackground(S.img.src);
    await addOverlayFromSrc(cutout, 0.6); // place the cut-out subject as an overlay
    setNotice(st, "ok", "Background removed — added as an overlay layer; drag to position.");
  } catch (e) {
    setNotice(st, "bad", `Background removal unavailable: ${escapeHTML(e.message)}. It needs the Cover Forge API with rembg (the GPU box) — see server/. Everything else works offline.`);
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
};

/* ---------- export ---------- */
$("expWrap").onclick = exportWrap;
$("expEbook").onclick = exportEbook;
$("expPdf").onclick = async () => {
  const btn = $("expPdf"), st = $("pdfStatus"), cmyk = $("pdfCmyk").checked;
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Generating PDF…";
  st.classList.remove("show");
  try {
    const { cmykMode, dimMatch } = await exportPDF({ cmyk });
    let msg = "Print PDF downloaded.";
    if (dimMatch === "off") msg += " The API reported a 300-DPI dimension mismatch; verify the PDF before upload.";
    if (cmyk && cmykMode === "naive") msg += " CMYK used a built-in conversion (no ICC profile on the server) — order a proof before a print run.";
    else if (cmyk && cmykMode === "icc") msg += " CMYK converted with the server's ICC profile.";
    setNotice(st, "ok", msg);
  } catch (e) {
    setNotice(st, "bad", `PDF export failed: ${escapeHTML(e.message)}. The PNG wrap above still works without the API — the PDF needs the Cover Forge API running (see <span class="mono">server/</span>).`);
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
};

/* ---------- image size + position: slider, reset, drag to pan, scroll to zoom ---------- */
$("scale").addEventListener("input", (e) => { S.imgScale = +e.target.value / 100; $("scaleL").textContent = e.target.value + "%"; rerender(); });
$("imgReset").onclick = () => { S.imgScale = 1; S.imgX = 0; S.imgY = 0; $("scale").value = 100; $("scaleL").textContent = "100%"; rerender(); };

// Canvas interactions: dragging the selected element (front block or overlay)
// takes priority; empty space pans the background image. Blocks snap to guides.
let imgDrag = false, ix, iy;
let drag = null; // { token, offX, offY } in canvas px

const canvasPt = (e) => {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) };
};
const capture = (id) => { try { cv.setPointerCapture(id); } catch (_) { /* inactive pointer */ } };
const overlayById = (id) => S.overlays.find((o) => o.id === id);

function dragSelected(e) {
  const p = canvasPt(e), d = dims(S), scale = getPrevScale();
  const ax = p.x + drag.offX, ay = p.y + drag.offY; // element center
  if (drag.token.startsWith("overlay:")) {
    const ov = overlayById(drag.token.slice(8)); if (!ov) return;
    ov.cx = clamp(ax / scale, 0, d.fullW);
    ov.cy = clamp(ay / scale, 0, d.fullH);
    rerender(); return;
  }
  const o = S[drag.token];
  const side = isBackBlock(drag.token) ? "back" : "front";
  const H = d.fullH * scale, x0 = (side === "back" ? d.backX : d.frontX) * scale, w = S.trimW * scale, tol = 10;
  const safe = safeArea(d, side);
  const topP = safe.y / d.fullH * 100, botP = (safe.y + safe.h) / d.fullH * 100;
  o.x = clamp(snap((ax - x0) / w, [0.5], tol / w), 0, 1);
  o.y = clamp(snap(ay / H * 100, [topP, 50, botP], tol / H * 100), 0, 100);
  syncBlockYSlider(drag.token);
  rerender();
}

// Keep the title/author vertical slider in step with a moved block.
function syncBlockYSlider(token) {
  if (token !== "title" && token !== "author") return;
  const yEl = token === "title" ? "tY" : "aY", yLab = token === "title" ? "tYL" : "aYL";
  $(yEl).value = clamp(Math.round(S[token].y), +$(yEl).min, +$(yEl).max);
  $(yLab).textContent = Math.round(S[token].y) + "%";
}

// Nudge the selected element by inches (keyboard arrows; Shift = coarse).
function nudgeSelected(dxIn, dyIn) {
  if (!S.selected) return;
  const d = dims(S);
  if (S.selected.startsWith("overlay:")) {
    const ov = overlayById(S.selected.slice(8)); if (!ov) return;
    ov.cx = clamp(ov.cx + dxIn, 0, d.fullW);
    ov.cy = clamp(ov.cy + dyIn, 0, d.fullH);
  } else {
    const o = S[S.selected];
    o.x = clamp(o.x + dxIn / S.trimW, 0, 1);
    o.y = clamp(o.y + dyIn / d.fullH * 100, 0, 100);
    syncBlockYSlider(S.selected);
  }
  rerender();
}

cv.addEventListener("pointerdown", (e) => {
  const p = canvasPt(e);
  if (S.view === "2d") {
    const token = pickAt(p.x, p.y);
    if (token) {
      const hb = getHitBox(token);
      drag = { token, offX: (hb.x + hb.w / 2) - p.x, offY: (hb.y + hb.h / 2) - p.y };
      S.selected = token; capture(e.pointerId); cv.style.cursor = "grabbing";
      updateOverlayPanel(); rerender(); return;
    }
  }
  if (S.selected) { S.selected = null; updateOverlayPanel(); rerender(); }
  if (!S.img) return;
  imgDrag = true; ix = e.clientX; iy = e.clientY; capture(e.pointerId); cv.style.cursor = "grabbing";
});
cv.addEventListener("pointermove", (e) => {
  if (drag) { dragSelected(e); return; }
  if (!imgDrag) {
    cv.style.cursor = (S.view === "2d" && pickAt(canvasPt(e).x, canvasPt(e).y)) ? "move" : (S.img ? "grab" : "default");
    return;
  }
  const r = cv.getBoundingClientRect();
  S.imgX += (e.clientX - ix) * (cv.width / r.width) / getPrevScale();
  S.imgY += (e.clientY - iy) * (cv.height / r.height) / getPrevScale();
  ix = e.clientX; iy = e.clientY; rerender();
});
cv.addEventListener("pointerup", () => { drag = null; imgDrag = false; cv.style.cursor = S.img ? "grab" : "default"; });
cv.addEventListener("wheel", (e) => {
  if (!S.img) return; e.preventDefault();
  const r = cv.getBoundingClientRect();
  const sx = cv.width / r.width, sy = cv.height / r.height;
  const px = (e.clientX - r.left) * sx, py = (e.clientY - r.top) * sy, scale = getPrevScale(), d = dims(S);
  let rx, ry, rw, rh;
  if (S.fit === "front") { const region = imageRegion(d, "front"); rx = d.frontX * scale; ry = 0; rw = region.w * scale; rh = region.h * scale; }
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

/* ---------- project save / load + control sync ---------- */
const sv = (id, v) => { const e = $(id); if (e) e.value = v; };
const svl = (id, labId, v, fmt) => { sv(id, v); const l = $(labId); if (l) l.textContent = fmt ? fmt(v) : v; };
const schk = (id, b) => { const e = $(id); if (e) e.checked = !!b; };
const scol = (id, labId, v) => {
  sv(id, v);
  const l = $(labId);
  if (l) { l.value = v; l.classList.remove("invalid"); l.setAttribute("aria-invalid", "false"); }
};
const sseg = (sel, attr, val) => document.querySelectorAll(sel + " button").forEach((b) => b.classList.toggle("on", b.dataset[attr] === String(val)));

function syncBlock(prefix, key) {
  const o = S[key];
  sv(prefix + "Text", o.text); sv(prefix + "Font", o.font);
  svl(prefix + "Size", prefix + "SizeL", o.size, (v) => v + " pt");
  scol(prefix + "Color", prefix + "ColorL", o.color);
  schk(prefix + "Caps", o.caps);
}

// Push the entire S object out to every control (after a project load/restore).
function syncUI() {
  const trimVal = `${S.trimW},${S.trimH}`;
  const hasOpt = [...$("trim").options].some((o) => o.value === trimVal);
  $("trim").value = hasOpt ? trimVal : "custom";
  $("customWrap").style.display = hasOpt ? "none" : "flex";
  sv("cw", S.trimW); sv("ch", S.trimH);
  sv("pages", S.pages); sv("paper", String(S.paper));
  sseg("#bindingSeg", "binding", S.binding);
  sv("spineOver", S.spineOverride != null ? S.spineOverride : "");
  applyBindingUI();

  sseg("#bgModeSeg", "bg", S.bgMode);
  $("solidWrap").style.display = S.bgMode === "solid" ? "block" : "none";
  $("gradWrap").style.display = S.bgMode === "gradient" ? "block" : "none";
  scol("bgColor", "bgColorL", S.bg);
  scol("gradFrom", "gradFromL", S.gradient.from);
  scol("gradTo", "gradToL", S.gradient.to);
  svl("gradAngle", "gradAngleL", S.gradient.angle, (v) => v + "°");

  sseg("#fitSeg", "fit", S.fit);
  svl("opacity", "opL", Math.round(S.imgOpacity * 100), (v) => v + "%");
  sv("imgBlend", S.imgBlend);
  svl("scale", "scaleL", Math.round(S.imgScale * 100), (v) => v + "%");

  sv("tTitle", S.title.text); sv("tFont", S.title.font);
  svl("tSize", "tSizeL", S.title.size, (v) => v + " pt");
  svl("tY", "tYL", Math.round(S.title.y), (v) => v + "%");
  scol("tColor", "tColorL", S.title.color);
  schk("tCaps", S.title.caps);
  svl("tLs", "tLsL", S.title.letterSpacing); svl("tLh", "tLhL", S.title.lineHeight);
  scol("tStrokeC", "tStrokeCL", S.title.stroke.color);
  svl("tStrokeW", "tStrokeWL", S.title.stroke.width, (v) => v + " pt");
  schk("tShadow", S.title.shadow);
  $("tShadowAdv").style.display = S.title.shadow ? "block" : "none";
  svl("tShBlur", "tShBlurL", S.title.shadowBlur, (v) => v + " pt");
  svl("tShDX", "tShDXL", S.title.shadowDX); svl("tShDY", "tShDYL", S.title.shadowDY);
  svl("tShOp", "tShOpL", Math.round((S.title.shadowOpacity ?? 0.45) * 100), (v) => v + "%");

  sv("aText", S.author.text); sv("aFont", S.author.font);
  svl("aSize", "aSizeL", S.author.size, (v) => v + " pt");
  svl("aY", "aYL", Math.round(S.author.y), (v) => v + "%");
  scol("aColor", "aColorL", S.author.color);
  schk("aCaps", S.author.caps); svl("aLs", "aLsL", S.author.letterSpacing);
  scol("aStrokeC", "aStrokeCL", S.author.stroke.color);
  svl("aStrokeW", "aStrokeWL", S.author.stroke.width, (v) => v + " pt");

  syncBlock("sub", "subtitle"); syncBlock("ser", "series"); syncBlock("pq", "pullquote");
  syncBlock("tag", "tagline"); syncBlock("bio", "bio");

  sv("sText", S.spine.text); scol("sColor", "sColorL", S.spine.color); schk("sFlip", S.spine.flip);

  sv("bText", S.back.text); sv("bFont", S.back.font);
  svl("bSize", "bSizeL", S.back.size, (v) => v + " pt");
  svl("bY", "bYL", Math.round(S.back.y), (v) => v + "%");
  svl("bLh", "bLhL", S.back.lineHeight);
  sseg("#bAlignSeg", "align", S.back.align);
  scol("bColor", "bColorL", S.back.color);

  updateOverlayPanel();
  schk("guides", S.guides);
  sseg("#viewSeg", "view", S.view);
  $("view2d").style.display = S.view === "2d" ? "block" : "none";
  $("view3d").style.display = S.view === "3d" ? "block" : "none";
  $("opL").textContent = Math.round(S.imgOpacity * 100) + "%";
  $("zlabel").textContent = S.zoom ? ("+" + S.zoom) : "fit";

  updateReadout();
  rerender();
}

const setProjStatus = (sev, msg) => setNotice($("projStatus"), sev, escapeHTML(msg));

function downloadJSON(obj, name) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const u = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000);
}
function projectFileName() {
  const t = (S.title.text || "cover").trim().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return (t || "cover") + ".coverforge.json";
}

function startNewProject() {
  const confirmed = window.confirm(
    "Start a new cover? This clears the current design and its autosave. Save the project first if you want to keep it."
  );
  if (!confirmed) return;

  clearTimeout(_saveTimer);
  clearTimeout(_commitTimer);
  resetProject();

  $("file").value = "";
  $("ovFile").value = "";
  $("projFile").value = "";
  $("genre").value = "";
  $("thumb").classList.remove("show");
  $("thumbImg").removeAttribute("src");
  cv.style.cursor = "default";
  renderSwatches();
  setNotice($("bgRemoveStatus"), "", null);

  syncUI();
  clearTimeout(_commitTimer);
  initHistory();

  // Replace the previous autosave immediately so a fast reload cannot restore
  // the cover that was just cleared. The blank project is small enough that the
  // normal image-quota fallback is unnecessary here.
  try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serialize())); }
  catch (_) { localStorage.removeItem(AUTOSAVE_KEY); }

  setProjStatus("ok", "New blank cover ready.");
  $("tTitle").focus();
}

// Apply a parsed project: design fields synchronously, image asynchronously.
async function applyProject(parsed) {
  // Validate and decode every embedded image before mutating S. A bad file can
  // therefore fail cleanly instead of leaving half of the new project applied.
  const project = validateProject(parsed);
  const background = project.image ? await cacheLoad(project.image) : null;
  if (project.image && !background) throw new Error("the embedded background image could not be decoded");
  const overlayImages = new Map();
  for (const ov of project.state.overlays || []) {
    const image = await cacheLoad(ov.src);
    if (!image) throw new Error(`overlay ${ov.id} could not be decoded`);
    overlayImages.set(ov.id, image);
  }

  restore(project);
  S.img = background;
  if (S.img) {
    $("thumb").classList.add("show"); $("thumbImg").src = project.image; cv.style.cursor = "grab"; extractPalette(S.img);
  } else {
    $("thumb").classList.remove("show"); S.palette = []; renderSwatches(); cv.style.cursor = "default";
  }
  for (const ov of S.overlays) ov.img = overlayImages.get(ov.id);
  syncUI();
}
function loadProjectFile(f) {
  if (f.size > MAX_PROJECT_FILE_BYTES) {
    setProjStatus("bad", `Could not load: project files are limited to ${Math.round(MAX_PROJECT_FILE_BYTES / 1024 / 1024)} MB.`);
    return;
  }
  const r = new FileReader();
  r.onload = async () => {
    try {
      await applyProject(JSON.parse(r.result));
      clearTimeout(_commitTimer);
      initHistory();
      setProjStatus("ok", "Project loaded.");
    }
    catch (err) { setProjStatus("bad", "Could not load: " + err.message); }
  };
  r.onerror = () => setProjStatus("bad", "Could not read the file.");
  r.readAsText(f);
}
$("saveProj").onclick = () => { downloadJSON(serialize(), projectFileName()); setProjStatus("ok", "Project saved to your downloads."); };
$("loadProj").onclick = () => $("projFile").click();
$("newProj").onclick = startNewProject;
$("projFile").onchange = (e) => { const f = e.target.files[0]; if (f) loadProjectFile(f); e.target.value = ""; };

$("undoBtn").onclick = undo;
$("redoBtn").onclick = redo;
const NUDGE = { fine: 0.01, coarse: 0.1 }; // inches per arrow press
window.addEventListener("keydown", (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return; // leave native field keys alone

  // selection keys (no modifier): arrows nudge, Esc deselects, Del removes an overlay
  if (S.selected && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const step = e.shiftKey ? NUDGE.coarse : NUDGE.fine;
    if (e.key === "ArrowLeft") { e.preventDefault(); nudgeSelected(-step, 0); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); nudgeSelected(step, 0); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); nudgeSelected(0, -step); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); nudgeSelected(0, step); return; }
    if (e.key === "Escape") { e.preventDefault(); S.selected = null; updateOverlayPanel(); rerender(); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && S.selected.startsWith("overlay:")) {
      e.preventDefault(); const ov = selectedOverlay();
      if (ov) { S.overlays = S.overlays.filter((o) => o !== ov); S.selected = null; updateOverlayPanel(); rerender(); }
      return;
    }
  }

  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((e.key === "z" && e.shiftKey) || e.key === "y") { e.preventDefault(); redo(); }
});

/* ---------- boot ---------- */
async function boot() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) await applyProject(JSON.parse(raw)); // restores last session
  } catch (_) { /* ignore a corrupt autosave */ }
  booted = true; // autosave + history enabled only after restore settles
  initHistory();
  updateReadout();
  ensureFontsLoaded().then(rerender);
  setTimeout(rerender, 300);
}
window.addEventListener("resize", () => { clearTimeout(window._rt); window._rt = setTimeout(rerender, 120); });
boot();
