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
  /** L4 layer number per cluster (optional; degrades gracefully when absent). */
  layerByCluster: ReadonlyMap<string, number>;
}
