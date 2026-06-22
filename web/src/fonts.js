// fonts.js — cover-design font list + ensure-loaded-before-export helper.
// These are the fonts offered for the BOOK covers themselves (the app chrome —
// Space Grotesk / Inter / Space Mono — is separate, see CLAUDE.md). The faces
// are loaded by the Google Fonts <link> in index.html; this module centralizes
// the family list and a single readiness gate.

export const FONTS = [
  // Serif
  "Playfair Display",
  "Cormorant Garamond",
  "EB Garamond",
  "Libre Baskerville",
  // Sans / display
  "Oswald",
  "Bebas Neue",
  "Montserrat",
  "Archivo Black",
];

// Resolve once the browser reports all linked faces are ready, so the first
// render (and any canvas export) draws with real type, not a fallback.
export function ensureFontsLoaded() {
  return document.fonts ? document.fonts.ready : Promise.resolve();
}
