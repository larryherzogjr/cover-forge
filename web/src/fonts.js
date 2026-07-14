// fonts.js — ensure cover fonts are loaded before render/export. The faces are
// linked from Google Fonts in index.html (the cover-design menu is separate from
// the app chrome — Space Grotesk / Inter / Space Mono; see CLAUDE.md). Canvas
// rasterizes a fallback for any face that hasn't loaded yet, so exports must
// await loadFonts() for the families actually in use.

// One catalog feeds every cover-text menu. Keep this separate from the app
// chrome families (Space Grotesk / Inter / Space Mono) so adding a design font
// cannot accidentally restyle the editor itself.
export const COVER_FONT_GROUPS = [
  {
    label: "Serif",
    families: [
      "Playfair Display", "Cormorant Garamond", "EB Garamond",
      "Libre Baskerville", "Lora", "Merriweather", "Crimson Pro",
      "DM Serif Display", "Cinzel", "Roboto Slab",
    ],
  },
  {
    label: "Sans / display",
    families: [
      "Oswald", "Bebas Neue", "Montserrat", "Archivo Black", "Raleway",
      "Poppins", "Anton", "League Spartan",
    ],
  },
];

export const COVER_FONTS = COVER_FONT_GROUPS.flatMap((group) => group.families);

export function populateFontSelect(select, selected) {
  if (!select) return;
  select.replaceChildren();
  for (const group of COVER_FONT_GROUPS) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    for (const family of group.families) {
      const option = document.createElement("option");
      option.value = family;
      option.textContent = family;
      optgroup.appendChild(option);
    }
    select.appendChild(optgroup);
  }
  select.value = selected;
}

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
