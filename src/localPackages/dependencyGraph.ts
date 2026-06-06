/**
 * Pure dependency-ordering logic for locally-developed npm packages.
 *
 * Given a set of packages and their in-set dependency edges (a package's
 * `dependencies` that point at *another package in the same set*), this builds the
 * topological "rounds" the user asked for: round 0 are the packages that depend on
 * nothing in the set, round 1 are the packages whose dependencies are all in round 0,
 * and so on (Kahn's algorithm by levels). It also resolves, for a given service, the
 * transitive subset of packages that service needs, ordered the same way.
 *
 * This module is intentionally free of Node/VS Code APIs so it can be unit-tested in
 * isolation, like the other pure helpers in `src/`.
 */

export interface PackageNode {
  readonly name: string;
  /** Names of *other packages in the same set* this package depends on. */
  readonly deps: readonly string[];
}

export interface BuildOrder {
  /** Packages grouped by dependency level; each round can build after the previous. */
  readonly rounds: readonly (readonly string[])[];
  /** All package names flattened in a valid build order (rounds concatenated). */
  readonly ordered: readonly string[];
}

/**
 * Thrown when the package graph contains a cycle and therefore has no valid build
 * order. `cycleNodes` lists the packages that could not be ordered.
 */
export class DependencyCycleError extends Error {
  readonly cycleNodes: readonly string[];

  constructor(cycleNodes: readonly string[]) {
    super(
      `Dependency cycle detected among local packages: ${[...cycleNodes].sort().join(', ')}`
    );
    this.name = 'DependencyCycleError';
    this.cycleNodes = [...cycleNodes].sort();
  }
}

/**
 * Computes the topological build rounds for `nodes` using Kahn's algorithm.
 * Dependency edges that point outside the provided set are ignored (defensive: a
 * package may list deps that are not locally developed). Throws
 * {@link DependencyCycleError} if the packages cannot be fully ordered.
 */
export function buildDependencyOrder(nodes: readonly PackageNode[]): BuildOrder {
  const names = new Set(nodes.map((node) => node.name));

  // remainingDeps: unmet in-set dependencies per package.
  const remainingDeps = new Map<string, Set<string>>();
  // dependents: who depends on a given package (reverse edges).
  const dependents = new Map<string, string[]>();

  for (const node of nodes) {
    const inSetDeps = new Set<string>();
    for (const dep of node.deps) {
      if (dep !== node.name && names.has(dep)) {
        inSetDeps.add(dep);
      }
    }
    remainingDeps.set(node.name, inSetDeps);
  }

  for (const [name, deps] of remainingDeps) {
    for (const dep of deps) {
      const list = dependents.get(dep);
      if (list === undefined) {
        dependents.set(dep, [name]);
      } else {
        list.push(name);
      }
    }
  }

  const rounds: string[][] = [];
  const placed = new Set<string>();

  let frontier = [...remainingDeps.entries()]
    .filter(([, deps]) => deps.size === 0)
    .map(([name]) => name)
    .sort();

  while (frontier.length > 0) {
    rounds.push(frontier);
    for (const name of frontier) {
      placed.add(name);
    }

    const nextFrontier = new Set<string>();
    for (const name of frontier) {
      for (const dependent of dependents.get(name) ?? []) {
        const deps = remainingDeps.get(dependent);
        if (deps === undefined) {
          continue;
        }
        deps.delete(name);
        if (deps.size === 0 && !placed.has(dependent)) {
          nextFrontier.add(dependent);
        }
      }
    }
    frontier = [...nextFrontier].sort();
  }

  if (placed.size !== nodes.length) {
    const unresolved = nodes.map((node) => node.name).filter((name) => !placed.has(name));
    throw new DependencyCycleError(unresolved);
  }

  return { rounds, ordered: rounds.flat() };
}

/**
 * Returns the transitive set of package names a service needs, starting from the
 * service's own dependency names and following in-set edges. The starting names that
 * are not part of `nodes` are ignored.
 */
export function resolveServiceClosure(
  serviceDepNames: readonly string[],
  nodes: readonly PackageNode[]
): Set<string> {
  const byName = new Map(nodes.map((node) => [node.name, node]));
  const closure = new Set<string>();
  const stack = serviceDepNames.filter((name) => byName.has(name));

  while (stack.length > 0) {
    const name = stack.pop();
    if (name === undefined || closure.has(name)) {
      continue;
    }
    closure.add(name);
    const node = byName.get(name);
    for (const dep of node?.deps ?? []) {
      if (byName.has(dep) && !closure.has(dep)) {
        stack.push(dep);
      }
    }
  }

  return closure;
}

/**
 * Convenience: the ordered build rounds for just the packages a given service needs.
 * Combines {@link resolveServiceClosure} with {@link buildDependencyOrder} over the
 * restricted subset (so dependency edges to out-of-closure packages are dropped).
 */
export function buildOrderForService(
  serviceDepNames: readonly string[],
  nodes: readonly PackageNode[]
): BuildOrder {
  const closure = resolveServiceClosure(serviceDepNames, nodes);
  const subset = nodes
    .filter((node) => closure.has(node.name))
    .map((node) => ({
      name: node.name,
      deps: node.deps.filter((dep) => closure.has(dep)),
    }));
  return buildDependencyOrder(subset);
}
