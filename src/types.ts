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
