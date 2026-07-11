/**
 * Domain-concept overlay domain + IndexSpecs + JSON Schema.
 */

import type { IndexSpec, MetadataSchema } from "@kepello/nodegraph-core";
import type { ConceptKind } from "./types.js";

export const DOMAIN_CONCEPT_DOMAIN = "domain-concept";

/**
 * Per-overlay schema version (substrate 1.12.2). Part of this domain's
 * public contract; every registrant passes it. Bump when the metadata
 * schema changes shape; V1 baseline is `1`.
 */
export const DOMAIN_CONCEPT_SCHEMA_VERSION = 1;

export const DOMAIN_CONCEPT_METADATA_KIND = "domain-concept";

/**
 * One DDD-grounded sentence per `ConceptKind`, tied to what the actual
 * detector in `detectors.ts` looks for (not textbook DDD in the
 * abstract). Consumed by `conceptKind.enumDescriptions` below; the
 * `Record<ConceptKind, string>` annotation makes the compiler enforce
 * that every union member has an entry.
 */
const CONCEPT_KIND_DESCRIPTIONS: Record<ConceptKind, string> = {
  entity:
    "A domain object with continuous identity across state changes over time — detected via the `entity`/`large-class`-with-entity-shape class stereotype, or a TS interface/type-alias with 3+ fields plus either method behavior or an implementor (extends/implements edge).",
  "value-object":
    "An immutable, identity-less object defined solely by its attribute values — detected via the `data-class` stereotype with no mutator-shaped methods, or a shape-only interface/type-alias with 2+ fields and no methods.",
  "aggregate-root":
    "The single entry-point entity of a cluster of related entities, responsible for guarding the consistency of the whole aggregate — detected per-cluster as the entity with the most inbound same-cluster entity-to-entity references, requiring 2+ entities in the cluster and at least one such inbound reference.",
  "domain-service":
    "A stateless domain operation that doesn't naturally belong to any entity or value object, expressed as a standalone class — detected via the `controller`/`command` stereotype, 2 or fewer fields, at least one method, excluding adapter/gateway/client-flavored clusters.",
  "bounded-context":
    "An explicit boundary within which a model's ubiquitous language stays consistent — detected as an L3 cluster meeting minimum size/vocabulary/distinctiveness thresholds (default 3+ members, 5+ distinct vocabulary terms, 0.4+ distinctiveness ratio).",
};

export const DOMAIN_CONCEPT_METADATA_SCHEMA: MetadataSchema = {
  type: "object",
  title: "Recovered domain concept",
  description:
    "A DDD-style concept recovered from L1 / L3 / L4 facts: entity, value object, aggregate root, domain service, or bounded context. Candidate; operator-overrideable via config.",
  required: ["kind", "conceptId", "conceptKind", "name", "confidenceScore"],
  properties: {
    kind: {
      type: "string",
      enum: ["domain-concept"],
      title: "Discriminator",
    },
    conceptId: {
      type: "string",
      title: "Stable concept id",
      description:
        "Content-hash: `hash(conceptKind || name || clusterId)`. Stable while the conceptKind + name + cluster assignment holds.",
    },
    conceptKind: {
      type: "string",
      enum: ["entity", "value-object", "aggregate-root", "domain-service", "bounded-context"],
      enumDescriptions: CONCEPT_KIND_DESCRIPTIONS,
      title: "DDD concept kind",
    },
    name: {
      type: "string",
      title: "Concept name",
      description:
        "Element name (class name) for entity / value-object / aggregate-root / domain-service. TF-IDF-derived label for bounded-context (e.g., `bounded-context-orders`).",
    },
    displayName: {
      type: "string",
      title: "Operator override",
      description:
        "Takes precedence over `name` in human-facing renders. Operator sets via `.fathom/fathom.config.json` `domainModel.rename`.",
    },
    clusterId: {
      type: "string",
      title: "L3 cluster id",
      description:
        "Cluster the concept belongs to (or, for bounded-context, the cluster it IS). Optional — synthetic concepts may omit.",
    },
    language: {
      type: "string",
      title: "Language",
      description:
        "Source language. Set when all referenced elements share a language; absent for cross-language concepts (not produced in v1).",
    },
    confidenceScore: {
      type: "number",
      title: "Detection confidence",
      description:
        "Heuristic rank ∈ [0, 1]. Threshold via `domainModel.minConfidence` (default 0.6).",
    },
    distinctiveness: {
      type: "number",
      title: "Bounded-context vocabulary distinctiveness (observable-support field)",
      description:
        "`bounded-context` only. Fathom row 3.3.12 (overlay-confidence-honest-null-policy): raw (unclamped) TF-IDF vocabulary-distinctiveness ratio ∈ [0, 1] feeding confidenceScore's saturating term — persisted so two bounded-contexts that saturate at the same confidenceScore stay distinguishable by their real evidence. Absent for every other conceptKind.",
    },
    dominanceSupport: {
      type: "number",
      title: "Aggregate-root reference-count support (observable-support field)",
      description:
        "`aggregate-root` only. Fathom row 3.3.12 (overlay-confidence-honest-null-policy): total same-cluster entity-to-entity inbound references the winning entity's dominance ratio was computed over — a totalRefs=1 read is low-evidence in a way confidenceScore alone can't express. Absent for every other conceptKind.",
    },
  },
};

export const DOMAIN_CONCEPT_INDEXES: IndexSpec[] = [
  {
    name: "concepts_by_concept_id",
    fields: ["metadata.conceptId"],
    scope: {
      domain: DOMAIN_CONCEPT_DOMAIN,
      lifecycleState: "live",
      nonNull: ["metadata.conceptId"],
    },
    unique: true,
  },
  {
    name: "concepts_by_concept_kind",
    fields: ["metadata.conceptKind"],
    scope: {
      domain: DOMAIN_CONCEPT_DOMAIN,
      lifecycleState: "live",
      nonNull: ["metadata.conceptKind"],
    },
  },
  {
    name: "concepts_by_cluster",
    fields: ["metadata.clusterId"],
    scope: {
      domain: DOMAIN_CONCEPT_DOMAIN,
      lifecycleState: "live",
      nonNull: ["metadata.clusterId"],
    },
  },
  {
    name: "concepts_by_language",
    fields: ["metadata.language"],
    scope: {
      domain: DOMAIN_CONCEPT_DOMAIN,
      lifecycleState: "live",
      nonNull: ["metadata.language"],
    },
  },
];
