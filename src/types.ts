/**
 * Domain-concept overlay public types.
 */

import type { Edge, Node } from "@kepello/nodegraph-core";
import { DOMAIN_CONCEPT_METADATA_KIND } from "./schema.js";

export type ConceptKind =
  | "entity"
  | "value-object"
  | "aggregate-root"
  | "domain-service"
  | "bounded-context";

/**
 * Runtime enumeration of `ConceptKind`'s members — TS unions aren't
 * iterable at runtime, so this mirrors it explicitly. The `satisfies`
 * clause makes the compiler itself flag drift if a member is added to
 * or removed from `ConceptKind` without updating this array. Pins
 * `DOMAIN_CONCEPT_METADATA_SCHEMA`'s `conceptKind.enum` against the
 * real union in `schema.test.ts`.
 */
export const ALL_CONCEPT_KINDS = [
  "entity",
  "value-object",
  "aggregate-root",
  "domain-service",
  "bounded-context",
] as const satisfies readonly ConceptKind[];

/**
 * WHERE A CONCEPT VERDICT'S EVIDENCE CAME FROM (Fathom row
 * `identifier-derived-verdicts-claim-deterministic-authority`, 3.1.8.1 —
 * operator ruling 2026-07-14: "No naming convention may define code
 * meaning."). Mirrors `@kepello/nodegraph-analysis`'s `EvidenceProvenance`
 * (same 3.1.8.1 row) and `@kepello/nodegraph-use-cases`'s
 * `ConfidenceProvenance` precedent — a per-package local type, same
 * "plain-data" convention this package already follows.
 *
 * Ground truth per `ConceptKind` (constant, not per-instance — see
 * `detectors.ts` for the per-detector rationale):
 *
 * - `entity` / `value-object` / `domain-service` — always `"mixed"`.
 *   Every emission from every path in these three detectors runs through
 *   THREE name-based rejection gates (`isFixturePath`, `isHelperModule`,
 *   `OPTION_BAG_SUFFIX_RE`) — a name is necessary to EXCLUDE a candidate,
 *   and a verdict that SURVIVED that gate had its outcome shaped by a
 *   name (the name changed the outcome: it just happened not to reject
 *   THIS candidate). Never `"structural"` for these three kinds.
 * - `bounded-context` — always `"name"`. The ENTIRE admission signal
 *   (vocabulary distinctiveness) is computed by splitting IDENTIFIER
 *   NAMES into TF-IDF terms (`splitIdentifier`) — delete that and
 *   `tf.size` is always 0, `minVocabularySize` never clears, and NO
 *   bounded-context ever emits. A structural gate (`minClusterSize`)
 *   exists too, but can never admit ALONE.
 * - `aggregate-root` — always `"structural"`. ITS OWN admission logic
 *   (which entity in a cluster wins "root") reads only same-cluster
 *   entity-to-entity REFERENCE COUNTS — no identifier. (The entity it
 *   crowns carries its OWN `"mixed"` provenance as a SEPARATE `entity`
 *   concept record; `aggregate-root` is its own verdict.)
 *
 * REQUIRED on every `DomainConceptMetadata` / `DomainConceptInput` /
 * `ComputedConcept` (never optional) — an optional field defaults to
 * absent, and absent is exactly the ambiguity this row removes (pre-prod
 * no-silent-degradation discipline).
 */
export type EvidenceProvenance = "structural" | "name" | "mixed";

export interface DomainConceptMetadata {
  kind: typeof DOMAIN_CONCEPT_METADATA_KIND;
  conceptId: string;
  conceptKind: ConceptKind;
  name: string;
  displayName?: string;
  clusterId?: string;
  language?: string;
  confidenceScore: number;
  /**
   * `bounded-context` only. Fathom row 3.3.12
   * (overlay-confidence-honest-null-policy): observable-support field
   * — the raw (unclamped) vocabulary-distinctiveness ratio that feeds
   * `confidenceScore`'s saturating term. See `ComputedConcept
   * .distinctiveness` (detectors.ts) for the full rationale.
   */
  distinctiveness?: number;
  /**
   * `aggregate-root` only. Fathom row 3.3.12
   * (overlay-confidence-honest-null-policy): observable-support field
   * — total same-cluster entity-to-entity inbound references the
   * dominance ratio was computed over. See `ComputedConcept
   * .dominanceSupport` (detectors.ts) for the full rationale.
   */
  dominanceSupport?: number;
  /**
   * WHERE this concept's evidence came from (Fathom row
   * `identifier-derived-verdicts-claim-deterministic-authority`, 3.1.8.1)
   * — see `EvidenceProvenance`'s doc comment. REQUIRED, not optional.
   */
  evidenceProvenance: EvidenceProvenance;
  /**
   * LLM-supplied enrichment (Haiku-namer pipeline output). Persisted
   * via `DomainModelOverlay.setEnrichment` — never write directly via
   * `graph.supersedeNode` (Fathom row 5.0.39).
   */
  llmEnrichment?: {
    name?: string;
    displayName?: string;
    summary?: string;
    provenance?: Record<string, unknown>;
  };
}

export interface DomainConceptInput {
  conceptId: string;
  conceptKind: ConceptKind;
  name: string;
  displayName?: string;
  clusterId?: string;
  language?: string;
  confidenceScore: number;
  /** `bounded-context` only — see `DomainConceptMetadata.distinctiveness`. */
  distinctiveness?: number;
  /** `aggregate-root` only — see `DomainConceptMetadata.dominanceSupport`. */
  dominanceSupport?: number;
  /** See `DomainConceptMetadata.evidenceProvenance`. */
  evidenceProvenance: EvidenceProvenance;
  contentHash: string;
  /** L0 elements (classes/methods/etc.) implementing this concept — `realizedBy` edge targets. */
  realizedByElementIds: readonly string[];
  /** Other concept ids this concept contains — `containsConcept` edge targets. */
  containsConceptIds?: readonly string[];
  /** Bounded-context concept id this concept lives in — `partOfContext` edge target. */
  partOfContextId?: string;
  /** Other concept ids this one relates to — `relatedTo` edge targets. */
  relatedToConceptIds?: readonly string[];
}

export interface DomainConceptNode extends Omit<Node, "metadata"> {
  metadata: DomainConceptMetadata;
}

export interface DomainModelOverlay {
  insertConcept(input: DomainConceptInput): DomainConceptNode;
  renameConcept(conceptId: string, displayName: string): DomainConceptNode;
  /**
   * Write `llmEnrichment` onto a concept's metadata without changing
   * identity. Per Fathom row 5.0.39: this is the ONLY correct path to
   * persist LLM enrichment — calling `graph.supersedeNode` directly
   * tombstones the concept's `realizedBy` / `partOfContext` / `relatedTo`
   * edges and breaks membership.
   */
  setEnrichment(
    conceptId: string,
    enrichment: DomainConceptMetadata["llmEnrichment"],
  ): DomainConceptNode;
  tombstoneConcept(conceptId: string): void;
  listConcepts(): DomainConceptNode[];
  getConcept(conceptId: string): DomainConceptNode | undefined;
  conceptsByKind(conceptKind: ConceptKind): DomainConceptNode[];
  conceptsInCluster(clusterId: string): DomainConceptNode[];
  /** All `realizedBy` edges for the concept. */
  realizedByEdges(conceptId: string): Edge[];
  /** All `containsConcept` edges for the concept. */
  containsConceptEdges(conceptId: string): Edge[];
  /** All `relatedTo` edges for the concept. */
  relatedToEdges(conceptId: string): Edge[];
  /** The `partOfContext` edge (at most one per concept). */
  partOfContextEdge(conceptId: string): Edge | undefined;
}

/** Edge: concept → contained child concept (bounded context → its entities). */
export const CONTAINS_CONCEPT_EDGE_TYPE = "containsConcept";
/** Edge: concept → L0 element implementing it. */
export const REALIZED_BY_EDGE_TYPE = "realizedBy";
/** Edge: concept → bounded-context it lives in. */
export const PART_OF_CONTEXT_EDGE_TYPE = "partOfContext";
/** Edge: concept → other concept (DDD context map relationship; unlabeled in v1). */
export const RELATED_TO_EDGE_TYPE = "relatedTo";
