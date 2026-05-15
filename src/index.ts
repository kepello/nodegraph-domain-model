/**
 * Public API surface for `@kepello/nodegraph-domain-model`.
 */

// Schema
export {
  DOMAIN_CONCEPT_DOMAIN,
  DOMAIN_CONCEPT_INDEXES,
  DOMAIN_CONCEPT_METADATA_KIND,
  DOMAIN_CONCEPT_METADATA_SCHEMA,
} from "./schema.js";

// Types
export {
  CONTAINS_CONCEPT_EDGE_TYPE,
  PART_OF_CONTEXT_EDGE_TYPE,
  REALIZED_BY_EDGE_TYPE,
  RELATED_TO_EDGE_TYPE,
  type ConceptKind,
  type DomainConceptInput,
  type DomainConceptMetadata,
  type DomainConceptNode,
  type DomainModelOverlay,
} from "./types.js";

// Detection context
export type {
  DomainClusterInfo,
  DomainContext,
  DomainEdge,
  DomainElement,
} from "./context.js";

// Identity
export { computeConceptId } from "./identity.js";

// Detectors
export {
  detectAggregateRoots,
  detectBoundedContexts,
  detectDomainServices,
  detectEntities,
  detectValueObjects,
  type ComputedConcept,
} from "./detectors.js";

// Recovery runner
export {
  recoverDomainModel,
  type RecoverDomainModelInput,
  type RecoverDomainModelOptions,
  type RecoverDomainModelResult,
} from "./recovery.js";

// Overlay
export {
  DomainModelOverlayImpl,
  makeDomainModelOverlay,
} from "./overlay.js";
