// state.js — the live editor state object `S`.
// Layout values are stored in INCHES (pan) and unitless multipliers (zoom) so
// the preview and the 300-DPI export produce an identical crop (invariant #3).
// Project save/load (serialize/restore S as portable JSON) lands in M3.

import { HC_PAGE_MAX, HC_PAGE_MIN, PAPER, normalizeHex } from "./kdp.js";

// Per-block text style defaults (M2). caps/stroke/letterSpacing/lineHeight and
// tunable shadow extend the original blocks without changing their look until
// the user touches them.
const titleStyle = {
  caps: false, letterSpacing: 0, lineHeight: 1.12,
  stroke: { color: "#0e1a2b", width: 0 },
  shadow: true, shadowDX: 1, shadowDY: 2, shadowBlur: 2, shadowColor: "#000000", shadowOpacity: 0.45,
};

export const S = {
  trimW: 6, trimH: 9, pages: 220, paper: PAPER.white,
  binding: "paperback",   // "paperback" | "hardcover"
  spineOverride: null,     // inches; overrides the estimated spine (hardcover: KDP calculator value)
  // background: base fill (solid|gradient) with the optional image composited on top.
  bgMode: "solid", bg: "#141414",
  gradient: { from: "#1d3251", to: "#0e1a2b", angle: 90 },
  img: null, fit: "wrap", palette: [], imgOpacity: 1, imgBlend: "source-over",
  imgScale: 1, imgX: 0, imgY: 0,
  // Front blocks: x is the horizontal CENTER as a fraction of the front trim
  // width (0.5 = centered); y is the vertical CENTER as a percent of full height.
  // Both are resolution-independent so preview == export. Drag to reposition.
  title: { text: "The Purest Gospel", font: "Playfair Display", size: 74, x: 0.5, y: 30, color: "#f4efe3", ...titleStyle },
  author: { text: "Larry Herzog Jr.", font: "Cormorant Garamond", size: 30, x: 0.5, y: 85, color: "#c6a75e", caps: false, letterSpacing: 0, lineHeight: 1.12, stroke: { color: "#0e1a2b", width: 0 } },
  // Optional front blocks — empty by default (drawn only once they have text),
  // share the title/author shape so the same render + drag machinery applies.
  subtitle: { text: "", font: "Cormorant Garamond", size: 28, x: 0.5, y: 33, color: "#e9e3d4", caps: false, letterSpacing: 0, lineHeight: 1.15, stroke: { color: "#0e1a2b", width: 0 } },
  series: { text: "", font: "Montserrat", size: 16, x: 0.5, y: 10, color: "#c6a75e", caps: true, letterSpacing: 2, lineHeight: 1.15, stroke: { color: "#0e1a2b", width: 0 } },
  pullquote: { text: "", font: "EB Garamond", size: 15, x: 0.5, y: 80, color: "#d9c9a3", caps: false, letterSpacing: 0, lineHeight: 1.2, stroke: { color: "#0e1a2b", width: 0 } },
  // Optional back blocks — same shape, positioned on the back panel (drag/nudge).
  tagline: { text: "", font: "Montserrat", size: 18, x: 0.5, y: 8, color: "#c6a75e", caps: false, letterSpacing: 0, lineHeight: 1.2, stroke: { color: "#0e1a2b", width: 0 } },
  bio: { text: "", font: "EB Garamond", size: 12, x: 0.5, y: 82, color: "#cdbf9f", caps: false, letterSpacing: 0, lineHeight: 1.3, stroke: { color: "#0e1a2b", width: 0 } },
  spine: { text: "The Purest Gospel — Herzog", color: "#f4efe3", flip: false },
  back: {
    text: "Paul's letter to the Romans has shaped the church's confession of grace for two thousand years. In this volume the gospel is set forth in its purest form: God's righteousness revealed apart from the law, received by faith alone, for the ungodly.\n\nWritten for confessional Lutheran laity and for anyone wearied by moralism, these expositions move verse by verse through the whole epistle — justification, the bondage of the will, the comfort of election, and the shape of the Christian life lived from faith.\n\nHere is no self-help and no ladder to climb. Here is Christ, delivered in the ordinary means of grace, for you.",
    font: "EB Garamond", size: 16, y: 7, color: "#e9e3d4", align: "left", lineHeight: 1.34,
  },
  // Overlay layers (logos / cut-out subjects). Each: { id, src(dataURL),
  // img(transient), cx, cy (center, inches), w (inches), opacity, blend }.
  overlays: [],
  guides: true, view: "2d", zoom: 0, // zoom 0 = fit
  selected: null, // selection token: a block id, "overlay:<id>", or null
};

// A new cover keeps the editor's useful format/style defaults, but starts with
// no book-specific copy or artwork. Capture it once so reset cannot inherit
// fields from the project that happened to be open when the button was clicked.
const NEW_PROJECT_STATE = JSON.parse(JSON.stringify(S));
NEW_PROJECT_STATE.title.text = "";
NEW_PROJECT_STATE.author.text = "";
NEW_PROJECT_STATE.spine.text = "";
NEW_PROJECT_STATE.back.text = "";

export function resetProject() {
  deepMerge(S, JSON.parse(JSON.stringify(NEW_PROJECT_STATE)));
  S.img = null;
  S.palette = [];
  S.overlays = [];
  S.selected = null;
}

/* ---------- project save / load (portable JSON) ---------- */

export const PROJECT_VERSION = 1;
export const AUTOSAVE_KEY = "cover-forge:autosave";
export const MAX_PROJECT_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_DATA_URL_CHARS = 64 * 1024 * 1024;

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const BLEND_MODES = new Set(["source-over", "multiply", "screen", "overlay", "darken", "lighten"]);
const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

function imageDataUrl(value, path) {
  if (value == null) return null;
  if (typeof value !== "string" || !/^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*;base64,/i.test(value)) {
    throw new Error(`${path} must be an embedded base64 image`);
  }
  if (value.length > MAX_IMAGE_DATA_URL_CHARS) throw new Error(`${path} is too large`);
  return value;
}

function finiteNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e6) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}

function cleanOverlay(value, index) {
  const path = `state.overlays[${index}]`;
  if (!isPlainObject(value)) throw new Error(`${path} must be an object`);
  const allowed = new Set(["id", "src", "cx", "cy", "w", "opacity", "blend"]);
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key) || !allowed.has(key)) throw new Error(`${path}.${key} is not supported`);
  }
  if (typeof value.id !== "string" || !value.id || value.id.length > 100) throw new Error(`${path}.id is invalid`);
  const opacity = value.opacity == null ? 1 : finiteNumber(value.opacity, `${path}.opacity`);
  if (opacity < 0 || opacity > 1) throw new Error(`${path}.opacity must be between 0 and 1`);
  const blend = value.blend || "source-over";
  if (!BLEND_MODES.has(blend)) throw new Error(`${path}.blend is invalid`);
  const width = finiteNumber(value.w, `${path}.w`);
  if (width <= 0) throw new Error(`${path}.w must be positive`);
  const src = imageDataUrl(value.src, `${path}.src`);
  if (!src) throw new Error(`${path}.src is required`);
  return {
    id: value.id,
    src,
    cx: finiteNumber(value.cx, `${path}.cx`),
    cy: finiteNumber(value.cy, `${path}.cy`),
    w: width,
    opacity,
    blend,
  };
}

function cleanObject(source, template, path) {
  if (!isPlainObject(source)) throw new Error(`${path} must be an object`);
  const out = {};
  for (const key of Object.keys(source)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_KEYS.has(key) || !(key in template) || key === "img") {
      throw new Error(`${childPath} is not supported`);
    }
    if (key === "selected") continue; // selection is transient and never restored
    if (key === "overlays") {
      if (!Array.isArray(source[key]) || source[key].length > 100) throw new Error(`${childPath} must be an array of at most 100 layers`);
      out[key] = source[key].map(cleanOverlay);
      continue;
    }
    if (key === "palette") {
      if (!Array.isArray(source[key]) || source[key].length > 32) throw new Error(`${childPath} is invalid`);
      out[key] = source[key].map((color) => {
        const normalized = normalizeHex(color);
        if (!normalized) throw new Error(`${childPath} contains an invalid color`);
        return normalized;
      });
      continue;
    }

    const value = source[key], expected = template[key];
    if (isPlainObject(expected)) out[key] = cleanObject(value, expected, childPath);
    else if (typeof expected === "number") out[key] = finiteNumber(value, childPath);
    else if (expected === null && key === "spineOverride") {
      if (value !== null) finiteNumber(value, childPath);
      out[key] = value;
    } else if (typeof value !== typeof expected) {
      throw new Error(`${childPath} has the wrong type`);
    } else if (typeof value === "string") {
      if (value.length > 100000) throw new Error(`${childPath} is too long`);
      if (/^(?:bg|from|to|color|shadowColor)$/.test(key)) {
        const normalized = normalizeHex(value);
        if (!normalized) throw new Error(`${childPath} is not a valid color`);
        out[key] = normalized;
      } else out[key] = value;
    } else out[key] = value;
  }
  return out;
}

// Validate and copy an untrusted project before it can mutate live editor state.
export function validateProject(obj) {
  if (!isPlainObject(obj) || obj.app !== "cover-forge" || !isPlainObject(obj.state)) {
    throw new Error("not a Cover Forge project file");
  }
  if (obj.version !== PROJECT_VERSION) {
    throw new Error(`unsupported Cover Forge project version ${String(obj.version)}`);
  }
  const state = cleanObject(obj.state, NEW_PROJECT_STATE, "state");
  if (!Number.isInteger(state.pages) || state.pages < 24 || state.pages > 828) throw new Error("state.pages is out of range");
  if (!(state.trimW >= 3 && state.trimW <= 20 && state.trimH >= 3 && state.trimH <= 20)) throw new Error("trim dimensions are out of range");
  if (!["paperback", "hardcover"].includes(state.binding)) throw new Error("state.binding is invalid");
  if (state.binding === "hardcover" && (state.pages < HC_PAGE_MIN || state.pages > HC_PAGE_MAX)) {
    throw new Error("state.pages is outside the hardcover range");
  }
  if (!["solid", "gradient"].includes(state.bgMode)) throw new Error("state.bgMode is invalid");
  if (!["wrap", "front"].includes(state.fit)) throw new Error("state.fit is invalid");
  if (!["2d", "3d"].includes(state.view)) throw new Error("state.view is invalid");
  if (!Object.values(PAPER).includes(state.paper)) throw new Error("state.paper is invalid");
  if (!BLEND_MODES.has(state.imgBlend)) throw new Error("state.imgBlend is invalid");
  if (state.spineOverride != null && state.spineOverride <= 0) throw new Error("state.spineOverride must be positive");
  const overlayIds = new Set(state.overlays.map((overlay) => overlay.id));
  if (overlayIds.size !== state.overlays.length) throw new Error("state.overlays contains duplicate ids");
  return {
    app: "cover-forge",
    version: PROJECT_VERSION,
    savedAt: typeof obj.savedAt === "string" ? obj.savedAt : null,
    state,
    image: imageDataUrl(obj.image, "image"),
  };
}

// A JSON-serializable snapshot of the whole design. The live Image is stored as
// its data URL under `image`; everything else is plain data.
export function serialize() {
  const { img, overlays, ...rest } = S;
  const state = { ...rest, overlays: overlays.map(({ img: _i, ...o }) => o) };
  return {
    app: "cover-forge",
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    // strip transient live Images; overlays keep their data-URL `src`
    // Detach nested objects so a held snapshot cannot observe later live-state
    // mutations before it is written to disk or added to history.
    state: JSON.parse(JSON.stringify(state)),
    image: img ? img.src : null,
  };
}

// Deep-merge src INTO target, mutating existing nested objects in place rather
// than replacing them. This is essential: UI control bindings capture references
// to S's nested objects (S.title, S.gradient, S.title.stroke, …), so a load must
// not swap those objects out or the controls would silently disconnect.
function deepMerge(target, src) {
  for (const k of Object.keys(src)) {
    const v = src[k], cur = target[k];
    if (v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur)) {
      deepMerge(cur, v);
    } else {
      target[k] = v;
    }
  }
}

// Apply a parsed project into S (design fields only). Returns the image data
// URL (or null) for the caller to load asynchronously. Throws if it isn't ours.
export function restore(obj) {
  const project = validateProject(obj);
  // Reset first so fields absent from an older project cannot leak in from the
  // cover that happened to be open before the load.
  deepMerge(S, JSON.parse(JSON.stringify(NEW_PROJECT_STATE)));
  deepMerge(S, project.state);
  S.img = null;
  S.selected = null;
  return project.image;
}
