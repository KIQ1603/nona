const plain = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** A readable SKU (e.g. NON-LA-DO) built from the product and variant names; unique among `taken`. */
export function makeSku(productName: string, variantName: string, taken: string[] = []): string {
  const head = plain(productName).slice(0, 24) || 'NONA';
  const tail = plain(variantName).slice(0, 24);
  const base = [head, tail].filter(Boolean).join('-').slice(0, 56);
  let sku = base.length >= 2 ? base : `${base}0`.padStart(2, 'N');
  for (let n = 2; taken.includes(sku); n++) sku = `${base}-${n}`;
  return sku;
}
