// Builds the three picture stickers (rhinestone, pearl, shell) as transparent PNGs in scripts/sticker-assets/.
// Rhinestone and pearl are cut out of the shop's own photos in /sticker; the shell is drawn as a vector (the photo's
// shells overlap and cannot be cut out cleanly). Run: node scripts/make-sticker-assets.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(path.join(root, 'apps/api/package.json'))('sharp');
const out = path.join(root, 'scripts/sticker-assets');
const SIZE = 480;

/** A round cut-out of a photo: centre (x, y), radius r, with a soft 2 px edge. */
async function disc(file, x, y, r, name) {
  const side = Math.round(2 * r);
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}"><defs><radialGradient id="g"><stop offset="94%" stop-color="#fff"/><stop offset="100%" stop-color="#000"/></radialGradient></defs><circle cx="${r}" cy="${r}" r="${r}" fill="url(#g)"/></svg>`,
  );
  const circle = await sharp(mask).greyscale().toBuffer();
  const photo = await sharp(path.join(root, 'sticker', file))
    .extract({ left: Math.round(x - r), top: Math.round(y - r), width: side, height: side })
    .resize(SIZE, SIZE, { kernel: 'lanczos3' })
    .removeAlpha()
    .toBuffer();
  const alpha = await sharp(circle).resize(SIZE, SIZE).toBuffer();
  await sharp(photo).joinChannel(alpha).png({ compressionLevel: 9 }).toFile(path.join(out, name));
}

/** A scallop shell seen from above: a fan with ridges and a wavy edge, cream with soft shading. */
function shellSvg() {
  const cx = 100;
  const cy = 168;
  const R = 96;
  const bumps = 9;
  const a0 = (-158 * Math.PI) / 180;
  const a1 = (-22 * Math.PI) / 180;
  const pt = (a, r) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  let d = `M ${cx - 14} ${cy + 6}`;
  const [sx, sy] = pt(a0, R * 0.86);
  d += ` L ${sx.toFixed(1)} ${sy.toFixed(1)}`;
  for (let i = 0; i < bumps; i++) {
    const am = a0 + ((a1 - a0) * (i + 0.5)) / bumps;
    const ae = a0 + ((a1 - a0) * (i + 1)) / bumps;
    const [qx, qy] = pt(am, R * 1.07);
    const [ex, ey] = pt(ae, R * 0.95);
    d += ` Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  }
  d += ` L ${cx + 14} ${cy + 6} Q ${cx} ${cy + 20} ${cx - 14} ${cy + 6} Z`;
  let ridges = '';
  for (let i = 0; i <= bumps; i++) {
    const a = a0 + ((a1 - a0) * i) / bumps;
    const [x1, y1] = pt(a, 12);
    const [x2, y2] = pt(a, R * 0.93);
    ridges += `<path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="#b9a58a" stroke-opacity=".55" stroke-width="2.2" stroke-linecap="round"/>`;
    const am = a + (a1 - a0) / bumps / 2;
    if (i < bumps) {
      const [h1x, h1y] = pt(am, 30);
      const [h2x, h2y] = pt(am, R * 0.9);
      ridges += `<path d="M ${h1x.toFixed(1)} ${h1y.toFixed(1)} L ${h2x.toFixed(1)} ${h2y.toFixed(1)}" stroke="#ffffff" stroke-opacity=".85" stroke-width="5" stroke-linecap="round"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${SIZE}" height="${SIZE}">
<defs>
<radialGradient id="s" cx="50%" cy="85%" r="95%"><stop offset="0" stop-color="#f1e6d3"/><stop offset=".55" stop-color="#fffaf1"/><stop offset="1" stop-color="#ffffff"/></radialGradient>
<linearGradient id="e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8c7ac"/><stop offset="1" stop-color="#b6a186"/></linearGradient>
</defs>
<path d="${d}" fill="url(#s)" stroke="url(#e)" stroke-width="3" stroke-linejoin="round"/>
${ridges}
<ellipse cx="${cx}" cy="${cy - 2}" rx="22" ry="12" fill="#ecdfca" stroke="#b6a186" stroke-width="2"/>
</svg>`;
}

await disc('đá.jpeg', 245, 716, 57, 'da.png');
await disc('ngọc.jpeg', 256, 632, 58, 'ngoc.png');
await sharp(Buffer.from(shellSvg())).png({ compressionLevel: 9 }).toFile(path.join(out, 'vo-so.png'));
console.log('sticker assets written to', out);
