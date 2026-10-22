export type HatDeco = 'plain' | 'poem' | 'lotus' | 'band';
export interface HatOptions {
  straw: [string, string, string];
  strap: string;
  deco: HatDeco;
}

/**
 * Illustrated conical hat used by the brand landing (logo, hero, fallback art).
 * Pure and deterministic: every value is a number or one of the colours passed in by our own code.
 */
export function hatSVG(o: HatOptions, id: string): string {
  const cx = 200,
    ay = 36,
    by = 244,
    R = 186,
    ry = 44;
  const [s1, s2, s3] = o.straw;
  const st = o.strap;
  const Y = (t: number, dx = 0) =>
    ay + (by - ay) * t + ry * t * Math.sqrt(Math.max(0, 1 - Math.pow(dx / (R * t), 2)));
  let weave = '';
  for (let k = 1; k <= 14; k++) {
    const t = k / 15,
      y = ay + (by - ay) * t,
      w = R * t,
      e = ry * t;
    weave += `<path d="M${cx - w} ${y} A${w} ${e} 0 0 0 ${cx + w} ${y}" fill="none" stroke="#6b4a1a" stroke-opacity=".26" stroke-width="1.2"/>`;
    weave += `<path d="M${cx - w} ${y + 1.6} A${w} ${e} 0 0 0 ${cx + w} ${y + 1.6}" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="1"/>`;
  }
  let ribs = '';
  for (let k = 0; k <= 26; k++) {
    const a = (Math.PI * k) / 26;
    ribs += `<line x1="${cx}" y1="${ay}" x2="${(cx + R * Math.cos(a)).toFixed(1)}" y2="${(by + ry * Math.sin(a)).toFixed(1)}" stroke="#6b4a1a" stroke-opacity=".11"/>`;
  }
  const arc = (t: number, extra = '') => {
    const w = R * t,
      y = ay + (by - ay) * t,
      e = ry * t;
    return `<path d="M${cx - w} ${y} A${w} ${e} 0 0 0 ${cx + w} ${y}" fill="none" ${extra}/>`;
  };
  let deco = '';
  if (o.deco === 'poem') {
    [0.5, 0.6, 0.7, 0.8].forEach((t, i) => {
      deco += arc(
        t + 0.025,
        `stroke="#4a3210" stroke-opacity=".55" stroke-width="1.8" stroke-dasharray="${i % 2 ? '2 4 7 3 1 5' : '5 3 1 6 4 3'}"`,
      );
    });
    deco += `<circle cx="${cx}" cy="${Y(0.36) - 6}" r="9" fill="#c0392b" fill-opacity=".85"/><path d="M${cx - 34} ${Y(0.38, -34) + 8} q12 -8 22 0 t22 0 t22 0 t22 0" stroke="#2f5d8a" stroke-width="2" fill="none" opacity=".75"/>`;
  }
  if (o.deco === 'lotus') {
    const flower = (dx: number, t: number, s: number) => {
      const x = cx + dx,
        y = Y(t, dx);
      let p = '';
      [-62, -31, 31, 62, 0].forEach((r) => {
        p += `<ellipse cx="${x}" cy="${y - 9 * s}" rx="${4.6 * s}" ry="${10 * s}" transform="rotate(${r} ${x} ${y})" fill="${st}" fill-opacity="${r === 0 ? 1 : 0.82}" stroke="#fff" stroke-opacity=".6" stroke-width=".6"/>`;
      });
      return `<g>${[-1, 1]
        .map(
          (d) =>
            `<ellipse cx="${x + d * 15 * s}" cy="${y + 1}" rx="${11 * s}" ry="${4 * s}" transform="rotate(${d * -14} ${x + d * 15 * s} ${y + 1})" fill="#4c8a4f" opacity=".9"/>`,
        )
        .join('')}${p}<circle cx="${x}" cy="${y - 3 * s}" r="${2.2 * s}" fill="#ffd86b"/></g>`;
    };
    deco +=
      flower(-82, 0.78, 1) +
      flower(82, 0.78, 1) +
      flower(0, 0.86, 1.15) +
      flower(-38, 0.58, 0.7) +
      flower(38, 0.58, 0.7);
  }
  if (o.deco === 'band') {
    deco +=
      arc(0.92, `stroke="${st}" stroke-width="8"`) +
      arc(0.86, `stroke="#e5b93c" stroke-width="3"`) +
      arc(0.97, `stroke="#e5b93c" stroke-width="2" stroke-dasharray="1 7" stroke-linecap="round"`);
    for (let k = -4; k <= 4; k++) {
      const dx = k * 38,
        t = 0.77;
      deco += `<path d="M${cx + dx} ${Y(t, dx) - 7} l6 7 l-6 7 l-6 -7z" fill="${st}" stroke="#e5b93c" stroke-width="1"/>`;
    }
  }
  if (o.deco === 'plain') {
    deco += arc(
      0.97,
      `stroke="#6b4a1a" stroke-opacity=".35" stroke-width="1.5" stroke-dasharray="2 5" stroke-linecap="round"`,
    );
  }
  const body = `M${cx} ${ay} L${cx - R} ${by} A${R} ${ry} 0 0 0 ${cx + R} ${by} Z`;
  return `<svg viewBox="0 0 400 402" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;overflow:visible" aria-hidden="true">
  <defs>
   <linearGradient id="g${id}" x1="0" x2="1"><stop offset="0" stop-color="${s1}"/><stop offset=".48" stop-color="${s2}"/><stop offset="1" stop-color="${s3}"/></linearGradient>
   <radialGradient id="r${id}" cx=".34" cy=".38" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
   <radialGradient id="s${id}"><stop offset="0" stop-color="#000" stop-opacity=".28"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
   <clipPath id="c${id}"><path d="${body}"/></clipPath>
  </defs>
  <ellipse cx="200" cy="394" rx="150" ry="8" fill="url(#s${id})"/>
  <path d="${body}" fill="url(#g${id})"/>
  <g clip-path="url(#c${id})">${weave}${ribs}${deco}<path d="${body}" fill="url(#r${id})"/></g>
  <path d="M${cx - R} ${by} A${R} ${ry} 0 0 0 ${cx + R} ${by}" fill="none" stroke="${s3}" stroke-width="5" stroke-linecap="round"/>
  <path d="M${cx - R + 8} ${by + 1} A${R - 8} ${ry - 2} 0 0 0 ${cx + R - 8} ${by + 1}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.4"/>
  <path d="M${cx} ${ay} q-7 -10 0 -22 q7 12 0 22z" fill="${s3}"/>
  <g stroke="${st}" stroke-width="6" stroke-linecap="round" fill="none"><path d="M52 270C72 334 140 344 188 336"/><path d="M348 270C328 334 260 344 212 336"/></g>
  <g fill="${st}"><path d="M200 336C172 312 158 342 176 354C190 360 198 346 200 336z"/><path d="M200 336C228 312 242 342 224 354C210 360 202 346 200 336z"/></g>
  <g stroke="${st}" stroke-width="5" stroke-linecap="round" fill="none"><path d="M196 340C190 362 180 374 168 384"/><path d="M204 340C210 362 220 374 232 384"/></g>
  <circle cx="200" cy="338" r="5.5" fill="#000" fill-opacity=".28"/>
  </svg>`;
}

export const STRAW_NATURAL: HatOptions['straw'] = ['#f3dc96', '#e3bd6c', '#b58838'];
