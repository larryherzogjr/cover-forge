// state.js — the live editor state object `S`.
// Layout values are stored in INCHES (pan) and unitless multipliers (zoom) so
// the preview and the 300-DPI export produce an identical crop (invariant #3).
// Project save/load (serialize/restore S as portable JSON) lands in M3.

import { PAPER } from "./kdp.js";

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
  // background: base fill (solid|gradient) with the optional image composited on top.
  bgMode: "solid", bg: "#141414",
  gradient: { from: "#1d3251", to: "#0e1a2b", angle: 90 },
  img: null, fit: "wrap", palette: [], imgOpacity: 1, imgBlend: "source-over",
  imgScale: 1, imgX: 0, imgY: 0,
  // Front blocks: x is the horizontal CENTER as a fraction of the front trim
  // width (0.5 = centered); y is the vertical CENTER as a percent of full height.
  // Both are resolution-independent so preview == export. Drag to reposition.
  title: { text: "The Purest Gospel", font: "Playfair Display", size: 74, x: 0.5, y: 20, color: "#f4efe3", ...titleStyle },
  author: { text: "Larry Herzog Jr.", font: "Cormorant Garamond", size: 30, x: 0.5, y: 90, color: "#c6a75e", caps: false, letterSpacing: 0, lineHeight: 1.12, stroke: { color: "#0e1a2b", width: 0 } },
  // Optional front blocks — empty by default (drawn only once they have text),
  // share the title/author shape so the same render + drag machinery applies.
  subtitle: { text: "", font: "Cormorant Garamond", size: 28, x: 0.5, y: 33, color: "#e9e3d4", caps: false, letterSpacing: 0, lineHeight: 1.15, stroke: { color: "#0e1a2b", width: 0 } },
  series: { text: "", font: "Montserrat", size: 16, x: 0.5, y: 10, color: "#c6a75e", caps: true, letterSpacing: 2, lineHeight: 1.15, stroke: { color: "#0e1a2b", width: 0 } },
  pullquote: { text: "", font: "EB Garamond", size: 15, x: 0.5, y: 80, color: "#d9c9a3", caps: false, letterSpacing: 0, lineHeight: 1.2, stroke: { color: "#0e1a2b", width: 0 } },
  spine: { text: "The Purest Gospel — Herzog", color: "#f4efe3", flip: false },
  back: {
    text: "Paul's letter to the Romans has shaped the church's confession of grace for two thousand years. In this volume the gospel is set forth in its purest form: God's righteousness revealed apart from the law, received by faith alone, for the ungodly.\n\nWritten for confessional Lutheran laity and for anyone wearied by moralism, these expositions move verse by verse through the whole epistle — justification, the bondage of the will, the comfort of election, and the shape of the Christian life lived from faith.\n\nHere is no self-help and no ladder to climb. Here is Christ, delivered in the ordinary means of grace, for you.",
    font: "EB Garamond", size: 16, y: 7, color: "#e9e3d4", align: "left", lineHeight: 1.34,
  },
  guides: true, view: "2d", zoom: 0, // zoom 0 = fit
  selected: null, // id of the currently-selected draggable block ("title"|"author"|null)
};
