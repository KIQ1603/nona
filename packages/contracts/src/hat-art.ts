/**
 * Drawing of a Vietnamese conical hat (nón lá) seen from slightly above: bamboo strips running from the
 * apex to the rim, stitched rings, a woven rim. Pure SVG markup with no external references, shared by the
 * designer (the generic hat used when a product has no picture) and the demo product art.
 */
export interface HatTone {
  base: string;
  light: string;
  dark: string;
  rim: string;
}
export const NATURAL_HAT: HatTone = {
  base: '#e0c88f',
  light: '#f2e4b9',
  dark: '#c4a265',
  rim: '#a9783a',
};
export const DARK_HAT: HatTone = {
  base: '#4a4843',
  light: '#6a665e',
  dark: '#2e2d2a',
  rim: '#1f1e1c',
};

/** Geometry in the 400 x 500 designer canvas: apex on top, a wide elliptical rim underneath. */
export const HAT_GEOMETRY = { cx: 200, apexY: 150, rimY: 288, rx: 160, ry: 70 } as const;
const COS = (() => {
  const { apexY, rimY, ry } = HAT_GEOMETRY;
  const sinPhi = ry / (rimY - apexY); // where the cone's sides touch the rim ellipse
  return { sin: sinPhi, cos: Math.sqrt(1 - sinPhi * sinPhi) };
})();
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Points where the straight sides of the cone touch the rim ellipse (on its far half). */
const TANGENT = {
  x: r2(HAT_GEOMETRY.rx * COS.cos),
  y: r2(HAT_GEOMETRY.rimY - HAT_GEOMETRY.ry * COS.sin),
};
/** The visible silhouette: straight sides from the apex, then the rim bulging round the bottom. */
export const HAT_OUTLINE = `M${HAT_GEOMETRY.cx} ${HAT_GEOMETRY.apexY} L${HAT_GEOMETRY.cx - TANGENT.x} ${TANGENT.y} A${HAT_GEOMETRY.rx} ${HAT_GEOMETRY.ry} 0 1 0 ${HAT_GEOMETRY.cx + TANGENT.x} ${TANGENT.y} Z`;

const n = (v: number) => Math.round(v * 100) / 100;

/** Inner markup (no <svg> wrapper). `uid` keeps gradient ids unique when several hats share a page. */
export function hatMarkup(uid: string, tone: HatTone = NATURAL_HAT): string {
  const { cx, apexY: ay, rimY: cy, rx, ry } = HAT_GEOMETRY;
  const phi = Math.atan2(COS.sin, COS.cos);
  const from = Math.PI + phi; // left tangent point
  const span = Math.PI + 2 * phi; // round the front down to the right tangent point
  const strips: string[] = [];
  const STRIPS = 110;
  for (let i = 0; i <= STRIPS; i++) {
    const a = from - span * (i / STRIPS);
    const x = cx + rx * Math.cos(a);
    const y = cy + ry * Math.sin(a);
    const color = i % 2 === 0 ? tone.light : tone.dark;
    strips.push(
      `<line x1="${cx}" y1="${ay}" x2="${n(x)}" y2="${n(y)}" stroke="${color}" stroke-opacity="${i % 2 === 0 ? 0.24 : 0.16}" stroke-width="1.1"/>`,
    );
  }
  const rings = [0.18, 0.34, 0.5, 0.66, 0.82]
    .map((f) => {
      const x1 = cx - TANGENT.x * f;
      const x2 = cx + TANGENT.x * f;
      const ty = ay + (TANGENT.y - ay) * f;
      return `<path d="M${n(x1)} ${n(ty)} A${n(rx * f)} ${n(ry * f)} 0 1 0 ${n(x2)} ${n(ty)}" fill="none" stroke="${tone.dark}" stroke-opacity=".5" stroke-width="1.2"/>`;
    })
    .join('');
  const rim = `M${cx - TANGENT.x} ${TANGENT.y} A${rx} ${ry} 0 1 0 ${cx + TANGENT.x} ${TANGENT.y}`;
  const rimIn = `M${cx - TANGENT.x * 0.985} ${TANGENT.y - 1} A${rx - 5} ${ry - 4} 0 1 0 ${cx + TANGENT.x * 0.985} ${TANGENT.y - 1}`;
  return `<defs>
<linearGradient id="${uid}-body" x1="0" y1="0" x2="1" y2="0.15"><stop offset="0" stop-color="${tone.base}"/><stop offset=".45" stop-color="${tone.light}"/><stop offset="1" stop-color="${tone.base}"/></linearGradient>
<linearGradient id="${uid}-shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".06"/><stop offset=".5" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></linearGradient>
<clipPath id="${uid}-shape"><path d="${HAT_OUTLINE}"/></clipPath>
</defs>
<path d="${HAT_OUTLINE}" fill="url(#${uid}-body)"/>
<g clip-path="url(#${uid}-shape)">${strips.join('')}${rings}<path d="${HAT_OUTLINE}" fill="url(#${uid}-shade)"/></g>
<path d="${rim}" fill="none" stroke="${tone.rim}" stroke-width="7" stroke-linecap="butt"/>
<path d="${rimIn}" fill="none" stroke="${tone.light}" stroke-opacity=".5" stroke-width="1.5"/>
<circle cx="${cx}" cy="${ay + 2}" r="4.5" fill="${tone.dark}"/>`;
}

/** A standalone SVG picture of the hat, cropped to the hat, transparent background (product art, demos). */
export function hatPictureSvg(tone: HatTone = NATURAL_HAT, uid = 'h'): string {
  const { cx, apexY, rimY, rx, ry } = HAT_GEOMETRY;
  const x = cx - rx - 8;
  const y = apexY - 8;
  const w = rx * 2 + 16;
  const h = rimY + ry - apexY + 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w * 2}" height="${h * 2}" role="img">${hatMarkup(uid, tone)}</svg>\n`;
}
export const HAT_PICTURE_SIZE = {
  width: (160 * 2 + 16) * 2,
  height: (288 + 70 - 150 + 16) * 2,
} as const;
