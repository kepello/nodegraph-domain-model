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
  const valueObjects = detectValueObjects(input.context);
  const domainServices = detectDomainServices(input.context);
  const boundedContexts = detectBoundedContexts(input.context, { minClusterSize });

  const rawCountsByKind = new Map<string, number>([
    ["entity", entities.length],
    ["aggregate-root", aggregateRoots.length],
    ["value-object", valueObjects.length],
    ["domain-service", domainServices.length],
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
