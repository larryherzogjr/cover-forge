// state.js — the live editor state object `S`.
// Layout values are stored in INCHES (pan) and unitless multipliers (zoom) so
// the preview and the 300-DPI export produce an identical crop (invariant #3).
// Project save/load (serialize/restore S as portable JSON) lands in M3.

import { PAPER } from "./kdp.js";

export const S = {
  trimW: 6, trimH: 9, pages: 220, paper: PAPER.white,
  img: null, fit: "wrap", palette: [], imgOpacity: 1, bg: "#141414",
  imgScale: 1, imgX: 0, imgY: 0,
  title: { text: "The Purest Gospel", font: "Playfair Display", size: 74, y: 20, color: "#f4efe3", shadow: true },
  author: { text: "Larry Herzog Jr.", font: "Cormorant Garamond", size: 30, y: 90, color: "#c6a75e" },
  spine: { text: "The Purest Gospel — Herzog", color: "#f4efe3", flip: false },
  back: {
    text: "Paul's letter to the Romans has shaped the church's confession of grace for two thousand years. In this volume the gospel is set forth in its purest form: God's righteousness revealed apart from the law, received by faith alone, for the ungodly.\n\nWritten for confessional Lutheran laity and for anyone wearied by moralism, these expositions move verse by verse through the whole epistle — justification, the bondage of the will, the comfort of election, and the shape of the Christian life lived from faith.\n\nHere is no self-help and no ladder to climb. Here is Christ, delivered in the ordinary means of grace, for you.",
    font: "EB Garamond", size: 16, y: 7, color: "#e9e3d4", align: "left",
  },
  guides: true, view: "2d", zoom: 0, // zoom 0 = fit
};
