import { describe, expect, it } from 'vitest';

import {
  DependencyCycleError,
  buildDependencyOrder,
  buildOrderForService,
  resolveServiceClosure,
  type PackageNode,
} from './dependencyGraph';

// A small package set mirroring the layout the feature was designed against:
// two roots (core, utils) and three packages that depend on them.
const PACKAGES: PackageNode[] = [
  { name: '@example/core', deps: [] },
  { name: '@example/config', deps: ['@example/core'] },
  { name: '@example/utils', deps: [] },
  { name: '@example/api', deps: ['@example/utils'] },
  { name: '@example/docs', deps: ['@example/utils'] },
];

describe('buildDependencyOrder', () => {
  it('groups packages into topological rounds (roots first)', () => {
    const { rounds } = buildDependencyOrder(PACKAGES);
    expect(rounds).toEqual([
      ['@example/core', '@example/utils'],
      ['@example/api', '@example/config', '@example/docs'],
    ]);
  });

  it('places every dependency before the package that needs it', () => {
    const { ordered } = buildDependencyOrder(PACKAGES);
    expect(ordered.indexOf('@example/core')).toBeLessThan(
      ordered.indexOf('@example/config')
    );
    expect(ordered.indexOf('@example/utils')).toBeLessThan(
      ordered.indexOf('@example/api')
    );
  });

  it('ignores dependency edges that point outside the package set', () => {
    const { ordered } = buildDependencyOrder([
      { name: 'a', deps: ['@sap/cds', 'lodash'] },
    ]);
    expect(ordered).toEqual(['a']);
  });

  it('handles a deep chain across multiple rounds', () => {
    const { rounds } = buildDependencyOrder([
      { name: 'c', deps: ['b'] },
      { name: 'b', deps: ['a'] },
      { name: 'a', deps: [] },
    ]);
    expect(rounds).toEqual([['a'], ['b'], ['c']]);
  });

  it('throws DependencyCycleError listing the unresolved packages', () => {
    expect(() =>
      buildDependencyOrder([
        { name: 'a', deps: ['b'] },
        { name: 'b', deps: ['a'] },
      ])
    ).toThrowError(DependencyCycleError);

    try {
      buildDependencyOrder([
        { name: 'a', deps: ['b'] },
        { name: 'b', deps: ['a'] },
      ]);
    } catch (error) {
      expect(error).toBeInstanceOf(DependencyCycleError);
      expect((error as DependencyCycleError).cycleNodes).toEqual(['a', 'b']);
    }
  });
});

describe('resolveServiceClosure', () => {
  it('returns only the transitive packages a service needs', () => {
    // Service consumes config + api → pulls core + utils too, but NOT docs.
    const closure = resolveServiceClosure(
      ['@example/config', '@example/api'],
      PACKAGES
    );
    expect([...closure].sort()).toEqual([
      '@example/api',
      '@example/config',
      '@example/core',
      '@example/utils',
    ]);
  });

  it('ignores service dependencies that are not local packages', () => {
    const closure = resolveServiceClosure(['@sap/cds', '@example/core'], PACKAGES);
    expect([...closure]).toEqual(['@example/core']);
  });
});

describe('buildOrderForService', () => {
  it('orders just the needed subset', () => {
    const { ordered } = buildOrderForService(['@example/config'], PACKAGES);
    expect(ordered).toEqual(['@example/core', '@example/config']);
  });
});
