import { describe, expect, it } from 'vitest';

import { truncatePreview } from './apiTracePreview';

describe('API trace preview handling', () => {
  it('truncates previews to a configured character budget', () => {
    expect(truncatePreview('abcdef', 4)).toEqual({ preview: 'abcd', truncated: true });
    expect(truncatePreview('abc', 4)).toEqual({ preview: 'abc', truncated: false });
    expect(truncatePreview('abc', 0)).toEqual({ preview: '', truncated: true });
  });
});
