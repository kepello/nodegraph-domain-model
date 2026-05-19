/**
 * Composite domain-model recovery runner. Invokes every per-kind
 * detector against the supplied context, applies a confidence
 * threshold, and returns ordered `ComputedConcept`s with their
 * content-hashed `conceptId`.
 *
 * Recovery order is deliberate: entities first (others reference
 * them), then aggregate roots (need the entity set), then value
 * objects + domain services + bounded contexts (independent).
 */

import type { DomainContext } from "./context.js";
import { computeConceptId } from "./identity.js";
import {
  detectAggregateRoots,
  detectBoundedContexts,
  detectDomainServices,
  detectEntities,
  detectValueObjects,
  type ComputedConcept,
} from "./detectors.js";

export interface RecoverDomainModelInput {
  context: DomainContext;
  options?: RecoverDomainModelOptions;
}

export interface RecoverDomainModelOptions {
  /** Default 0.6. */
  minConfidence?: number;
  /** Default 3. Used by bounded-context detection. */
  minClusterSize?: number;
}

export interface RecoverDomainModelResult {
  concepts: ReadonlyArray<ComputedConcept & { conceptId: string }>;
  rawCountsByKind: ReadonlyMap<string, number>;
}

export function recoverDomainModel(
  input: RecoverDomainModelInput,
): RecoverDomainModelResult {
  const minConfidence = input.options?.minConfidence ?? 0.6;
  const minClusterSize = input.options?.minClusterSize ?? 3;

  const entities = detectEntities(input.context);
  const aggregateRoots = detectAggregateRoots(input.context, entities);
  const valueObjectsRaw = detectValueObjects(input.context);
  const domainServicesRaw = detectDomainServices(input.context);
  const boundedContexts = detectBoundedContexts(input.context, { minClusterSize });

  // Fathom row 5.0.32: kind-exclusivity precedence. An element classified
  // as an entity is NOT also a value-object or a domain-service. The
  // detectors fire independently; precedence belongs at the composite
  // layer. DDD precedence: entity > value-object, entity > domain-service.
  // Aggregate-root is permitted to share an element with the entity it
  // anchors (the aggregate-root concept is an entity-with-extra-role).
  const entityElementIds = new Set<string>();
  for (const e of entities) {
    for (const id of e.realizedByElementIds) entityElementIds.add(id);
  }
  const valueObjects = valueObjectsRaw.filter(
    (vo) => !vo.realizedByElementIds.some((id) => entityElementIds.has(id)),
  );
  const domainServices = domainServicesRaw.filter(
    (ds) => !ds.realizedByElementIds.some((id) => entityElementIds.has(id)),
  );

  const rawCountsByKind = new Map<string, number>([
    ["entity", entities.length],
    ["aggregate-root", aggregateRoots.length],
    ["value-object", valueObjectsRaw.length],
    ["domain-service", domainServicesRaw.length],
    ["bounded-context", boundedContexts.length],
  ]);

  const all = [
    ...entities,
    ...aggregateRoots,
    ...valueObjects,
    ...domainServices,
    ...boundedContexts,
  ];

  const filtered = all
    .filter((c) => c.confidenceScore >= minConfidence)
    .map((c) => ({
      ...c,
      conceptId: computeConceptId(c.conceptKind, c.name, c.clusterId),
    }));

  filtered.sort((a, b) => {
    if (b.confidenceScore !== a.confidenceScore) {
      return b.confidenceScore - a.confidenceScore;
    }
    const byKind = a.conceptKind.localeCompare(b.conceptKind);
    if (byKind !== 0) return byKind;
    return a.name.localeCompare(b.name);
  });

  return { concepts: filtered, rawCountsByKind };
}
