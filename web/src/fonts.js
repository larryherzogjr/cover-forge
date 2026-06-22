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

// Force the given families to load at the weights we render (400/600/700) and
// resolve only once they're available. Canvas exports MUST await this — a face
// that hasn't loaded yet rasterizes as a fallback (CLAUDE.md: fonts loaded
// before any canvas export). Safe to call repeatedly; already-loaded faces are
// instant.
export async function loadFonts(families, weights = [400, 600, 700]) {
  if (!document.fonts) return;
  const uniq = [...new Set((families || []).filter(Boolean))];
  const jobs = [];
  for (const fam of uniq) {
    for (const w of weights) {
      try { jobs.push(document.fonts.load(`${w} 16px '${fam}'`)); } catch (_) { /* bad spec */ }
    }
  }
  await Promise.all(jobs).catch(() => { /* a missing face shouldn't block export */ });
  await document.fonts.ready;
}
