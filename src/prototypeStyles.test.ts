import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('prototype package/service mapping styles', () => {
  it('does not render a dotted underline under the Mapped badge', () => {
    const css = readFileSync(
      join(process.cwd(), 'docs/designs/prototypes/assets/prototype.css'),
      'utf8'
    );
    const mappedBadgeRule = css.match(/\.service-map-state-mapped\s*\{[^}]*\}/)?.[0] ?? '';

    expect(mappedBadgeRule).not.toMatch(/text-decoration\s*:\s*underline\s+dotted/i);
    expect(mappedBadgeRule).not.toMatch(/text-underline-offset/i);
  });
});
