import { describe, expect, it } from 'vitest';
import { describeError } from './admin-client';
import { ApiError } from './api-client';

describe('describeError', () => {
  it('lists publish issues and field errors from API details', () => {
    const e = Object.assign(
      new ApiError(409, 'PUBLISH_REQUIREMENTS_NOT_MET', 'Chưa đủ điều kiện.'),
      { details: { issues: ['Cần ít nhất 1 ảnh'] } },
    );
    expect(describeError(e)).toBe('Chưa đủ điều kiện. Cần ít nhất 1 ảnh');
    const v = Object.assign(new ApiError(400, 'VALIDATION_FAILED', 'Không hợp lệ.'), {
      details: { issues: [{ path: 'priceVnd', message: 'Số nguyên' }] },
    });
    expect(describeError(v)).toBe('Không hợp lệ. priceVnd: Số nguyên');
  });
  it('never leaks unknown error internals', () => {
    expect(describeError(new Error('secret stack'))).toBe('Có lỗi không xác định.');
  });
});
