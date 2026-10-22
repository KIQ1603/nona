import { DARK_HAT, HAT_PICTURE_SIZE, hatPictureSvg, NATURAL_HAT } from '@nona/contracts';

export interface HatArt {
  bg: string;
  accent: string;
  motif: string;
  rotation: number;
  dark?: boolean;
}

/** Size recorded for the seed pictures (they are vector: only the proportions matter). */
export const SEED_PICTURE_SIZE = HAT_PICTURE_SIZE;

/**
 * Illustrative nón lá picture used as seed imagery until real product photos are uploaded: the same drawing
 * the designer uses, cropped to the hat on a transparent background, so the shop and the designer look alike.
 */
export function hatSvg(art: HatArt, id: string): string {
  return hatPictureSvg(art.dark ? DARK_HAT : NATURAL_HAT, `s-${id}`);
}
