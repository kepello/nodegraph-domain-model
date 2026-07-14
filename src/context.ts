/**
 * Detection-context input shape. Matchers consume L0 element structure
 * + L1 stereotype labels + L3 cluster info + (optional) L4 layer
 * numbers as plain data — the package has no peer-deps on upstream
 * layer packages.
 */

export interface DomainElement {
  id: string;
  name: string;
  /** Structural kind from the wire: `class`, `interface`, `method`, `field`, `struct`, etc. */
  kind: string;
  language?: string;
  /**
   * Source-file path. Used by `isFixturePath` in detectors to reject
   * elements from `/tests/` / `/fixtures/` / etc. paths. Fathom row
   * 5.0.26 (b). When the caller doesn't supply this, fixture-path
   * exclusion silently skips (caller-opt-in pattern).
   */
  artifactId?: string;
  /**
   * Every non-administrative L0 facet the substrate carries for this
   * element (annotations, baseTypes, isStatic, scalars, ...), projected
   * by the caller's shared `projectElementFacets` helper (Fathom row
   * `overlay-projection-discards-14-of-19-facets`, 3.1.0.7). Plain
   * `Record<string, unknown>` — this package has no peer-dependency on
   * `@kepello/nodegraph-analysis` (same decoupling rationale as every
   * other plain-data field on this interface). Currently unconsumed by
   * any detector — this row makes the facts ARRIVE (e.g. `baseTypes`
   * carrying `System.Exception`/`System.Object` — half the structural
   * signal for a DDD value-object that was previously invisible to
   * every L7b detector); wiring a consumer is later work. Optional, not
   * required: making it required would force editing hundreds of
   * hand-built `DomainElement` literals across `detectors.test.ts` for a
   * field nothing reads yet.
   */
  facets?: Readonly<Record<string, unknown>>;
}

export interface DomainEdge {
  source: string;
  target: string;
}

export interface DomainClusterInfo {
  clusterId: string;
  name: string;
  displayName?: string;
  memberCount: number;
}

export interface DomainContext {
  elements: readonly DomainElement[];
  /** L1 class stereotypes (`entity`, `data-class`, `large-class`, etc.). */
  classStereotypes: ReadonlyMap<string, string>;
  /** L1 method stereotypes (`accessor-shaped`, `mutator-shaped`, `controller`, etc.). */
  methodStereotypes: ReadonlyMap<string, string>;
  /**
   * L1 `classRole` — the engine-owned semantic-role projection of
   * `classStereotype` (`@kepello/nodegraph-analysis` `ClassRole`:
   * `service` | `command-object` | `entity-candidate` | `data-holder` |
   * `boundary` | `error` | `utility` | `abstract-base` | `other`).
   * Fathom row `l7b-stereotype-vocabulary-drift` (3.3.11): detectors
   * MUST match on this projection, never on raw `classStereotype`
   * values — matching raw stereotypes silently strands whenever the
   * vocabulary expands (the drift class this contract closes). Plain
   * data (string), same shape as `classStereotypes` — no peer-dep on
   * `@kepello/nodegraph-analysis`.
   */
  classRoles: ReadonlyMap<string, string>;
  /**
   * L1 `methodRole` — the semantic-role projection of `methodStereotype`
   * (`@kepello/nodegraph-analysis` `MethodRole`: `entry-command` |
   * `mutator` | `factory` | `accessor` | `test-fixture` | `other`). See
   * `classRoles` above for the drift class this closes; same
   * plain-data, no-peer-dep shape.
   */
  methodRoles: ReadonlyMap<string, string>;
  /** Container → children ids (class → method/field children). */
  childrenOf: ReadonlyMap<string, readonly string[]>;
  /** Inverse of `childrenOf`. */
  parentOf: ReadonlyMap<string, string>;
  /** Identifier-mention edges (`references`). Used for entity-to-entity aggregate detection. */
  referencesEdges: readonly DomainEdge[];
  /** Inheritance edges (child → parents). */
  inheritsEdges: ReadonlyMap<string, readonly string[]>;
  /** L3 clusters (workspace-wide). */
  clusters: readonly DomainClusterInfo[];
  /** Element id → cluster id. */
  clusterByElement: ReadonlyMap<string, string>;
  /**
   * L4 layer number per cluster (optional; degrades gracefully when
   * absent). Currently unconsumed by any detector (Fathom row 3.3.12,
   * overlay-confidence-honest-null-policy): `detectBoundedContexts`'s
   * former `layerOk` gate read this but was a dead constant — one
   * layer number PER CLUSTER can never express "any member is in a
   * different layer," so the gate could never fail. Kept in the
   * contract as the input a future real per-member layer-integrity
   * check would need (widening `DomainContext` with per-element layer
   * data), not removed speculatively.
   */
  layerByCluster: ReadonlyMap<string, number>;
}
