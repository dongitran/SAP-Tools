import { describe, expect, it } from 'vitest';

import { generateVerdaccioConfigYaml } from './verdaccioConfig';

describe('generateVerdaccioConfigYaml', () => {
  it('binds to localhost on the given port', () => {
    const yaml = generateVerdaccioConfigYaml({ port: 4999, scopes: [] });
    expect(yaml).toContain('listen: localhost:4999');
    expect(yaml).toContain('storage: ./storage');
  });

  it('serves each configured scope locally (no proxy) with full publish access', () => {
    const yaml = generateVerdaccioConfigYaml({ port: 4873, scopes: ['@example', '@acme'] });
    expect(yaml).toContain("  '@example/*':");
    expect(yaml).toContain("  '@acme/*':");

    // The scope blocks must not proxy to npmjs (private packages stay local).
    const exampleBlock = yaml.slice(
      yaml.indexOf("  '@example/*':"),
      yaml.indexOf("  '@*/*':")
    );
    expect(exampleBlock).toContain('publish: $all');
    expect(exampleBlock).not.toContain('proxy: npmjs');
  });

  it('proxies everything else to the npmjs uplink', () => {
    const yaml = generateVerdaccioConfigYaml({ port: 4873, scopes: [] });
    expect(yaml).toContain('url: https://registry.npmjs.org/');
    expect(yaml).toContain("  '**':");
    expect(yaml).toContain('proxy: npmjs');
  });
});
