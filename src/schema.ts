/**
 * Domain-concept overlay domain + IndexSpecs + JSON Schema.
 */

import type { IndexSpec, MetadataSchema } from "@kepello/nodegraph-core";

export const DOMAIN_CONCEPT_DOMAIN = "domain-concept";

/**
 * Per-overlay schema version (substrate 1.12.2). Part of this domain's
 * public contract; every registrant passes it. Bump when the metadata
 * schema changes shape; V1 baseline is `1`.
 */
export const DOMAIN_CONCEPT_SCHEMA_VERSION = 1;

export const DOMAIN_CONCEPT_METADATA_KIND = "domain-concept";

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
