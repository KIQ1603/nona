import { describe, expect, it } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
  it('handles Vietnamese diacritics and đ', () => {
    expect(slugify('Nón Sen Thì Thầm')).toBe('non-sen-thi-tham');
    expect(slugify('Đẹp & Độc đáo!!')).toBe('dep-doc-dao');
  });
  it('returns empty string when nothing usable remains', () => {
    expect(slugify('***')).toBe('');
  });
});
