/**
 * Composite domain-model recovery runner. Invokes every per-kind
 * detector against the supplied context, applies a confidence
 * threshold, and returns ordered `ComputedConcept`s with their
 * content-hashed `conceptId` — PLUS, per Fathom row 3.1.8.4
 * (disposition-layer §S7 wave 3a), the named `refusals` for every
 * candidate this composite (or a detector's near-miss gate) considered
 * and refused. Refusals are RETURNED, never recorded here — wiring
 * them through `recordRefusal` is wave 3b.
 *
 * Recovery order is deliberate: entities first (others reference
 * them), then aggregate roots (need the entity set), then value
 * objects + domain services + bounded contexts (independent).
 *
 * ## Claim conservation (wave-3b denominator contract)
 *
 * `rawCountsByKind` counts DETECTOR OUTPUT (the raw claims — the L7b
 * selector denominator per the design's §S5). Every raw claim lands in
 * exactly one of:
 *   - `concepts` (persistable output),
 *   - `mergedClaimCount` (collapsed into a same-conceptId concept by the
 *     5.0.21.3 merge — a POSITIVE outcome, not a refusal: the claim's
 *     realizers union into the survivor),
 *   - a POST-CLAIM refusal (`kind-precedence-excluded` at the :62-67
 *     precedence filter, `below-confidence-threshold` at the minConfidence
 *     gate).
 * So: Σ rawCountsByKind = concepts.length + mergedClaimCount +
 * |post-claim refusals| — pinned by test.
 *
 * Detector-internal NEAR-MISS refusals (`no-entity-shape`, from
 * `detectValueObjects`/`detectDomainServices`) are PRE-claim: the
 * candidate was refused before a claim was emitted, so it is NOT in
 * `rawCountsByKind`. In wave 3b these join the stage's IN and refused
 * columns symmetrically (a stage declares the candidate set it COULD
 * have considered) — they never touch the raw-claims identity above.
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
  type DomainModelRefusal,
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
  /**
   * Wave 3a (Fathom row 3.1.8.4): every named refusal — detector
   * near-misses (`no-entity-shape`) + the composite's post-claim gates
   * (`kind-precedence-excluded`, `below-confidence-threshold`).
   * Computed and returned; recording is wave 3b.
   */
  refusals: ReadonlyArray<DomainModelRefusal>;
  /**
   * Raw claims collapsed into an already-present same-conceptId concept
   * by the 5.0.21.3 merge (EnvisionWeb measured 12 such collapses).
   * NOT refusals — needed so wave 3b can close the L7b ledger residual
   * to 0: Σ rawCountsByKind = concepts + mergedClaimCount + post-claim
   * refusals.
   */
  mergedClaimCount: number;
}

export function recoverDomainModel(
  input: RecoverDomainModelInput,
): RecoverDomainModelResult {
  const minConfidence = input.options?.minConfidence ?? 0.6;
  const minClusterSize = input.options?.minClusterSize ?? 3;

  const entities = detectEntities(input.context);
  const aggregateRoots = detectAggregateRoots(input.context, entities);
  const valueObjectDetection = detectValueObjects(input.context);
  const domainServiceDetection = detectDomainServices(input.context);
  const boundedContexts = detectBoundedContexts(input.context, { minClusterSize });
  const valueObjectsRaw = valueObjectDetection.concepts;
  const domainServicesRaw = domainServiceDetection.concepts;

  const refusals: DomainModelRefusal[] = [
    ...valueObjectDetection.refusals,
    ...domainServiceDetection.refusals,
  ];

  // Fathom row 5.0.32: kind-exclusivity precedence. An element classified
  // as an entity is NOT also a value-object or a domain-service. The
  // detectors fire independently; precedence belongs at the composite
  // layer. DDD precedence: entity > value-object, entity > domain-service.
  // Aggregate-root is permitted to share an element with the entity it
  // anchors (the aggregate-root concept is an entity-with-extra-role).
  //
  // Wave 3a (3.1.8.4): exclusion here is a named POST-CLAIM refusal —
  // `kind-precedence-excluded`. Note the domain-service arm is
  // structurally unreachable today (DS admits classes only, on roles
  // disjoint from `entity-candidate`; entity path 2 admits
  // interfaces/type-aliases only) — kept defensively, so the refusal
  // wiring covers it too, but only the value-object arm can fire (the
  // interface-shaped entity∩VO overlap, the 5.0.32 fixture).
  const entityElementIds = new Set<string>();
  for (const e of entities) {
    for (const id of e.realizedByElementIds) entityElementIds.add(id);
  }
  const excludeByPrecedence = (c: ComputedConcept): boolean => {
    const overlap = c.realizedByElementIds.filter((id) => entityElementIds.has(id));
    if (overlap.length === 0) return false;
    refusals.push({
      candidateRef: c.realizedByElementIds[0]!,
      reason: "kind-precedence-excluded",
      detail: {
        conceptKind: c.conceptKind,
        name: c.name,
        excludedBy: "entity",
        overlappingElementIds: overlap,
      },
    });
    return true;
  };
  const valueObjects = valueObjectsRaw.filter((vo) => !excludeByPrecedence(vo));
  const domainServices = domainServicesRaw.filter((ds) => !excludeByPrecedence(ds));

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

  // Confidence gate — POST-CLAIM refusal `below-confidence-threshold`,
  // detail {score, threshold, conceptKind} per the wave-3a contract.
  // NOTE (wave-3a floor analysis, pinned by test): every detector's score
  // FLOOR is ≥ 0.6 (entity 0.6 · VO 0.6 · DS 0.65 · AR > 0.6 · BC ≥ 0.7),
  // so at the DEFAULT threshold this gate never fires on any corpus —
  // it is live only under an operator-raised minConfidence.
  const passed: ComputedConcept[] = [];
  for (const c of all) {
    if (c.confidenceScore >= minConfidence) {
      passed.push(c);
      continue;
    }
    refusals.push({
      // Bounded-context claims are cluster-anchored; everything else is
      // element-anchored (single realizer for entity/VO/DS; the anchor
      // entity's realizers for AR).
      candidateRef:
        c.conceptKind === "bounded-context" && c.clusterId !== undefined
          ? c.clusterId
          : c.realizedByElementIds[0]!,
      reason: "below-confidence-threshold",
      detail: {
        score: c.confidenceScore,
        threshold: minConfidence,
        conceptKind: c.conceptKind,
        name: c.name,
      },
    });
  }

  const withIds = passed.map((c) => ({
    ...c,
    conceptId: computeConceptId(c.conceptKind, c.name, c.clusterId),
  }));

  // Merge same-identity concepts (Fathom row 5.0.21.3): conceptId is
  // (kind, name, clusterId) — two detector hits with the same triple
  // (e.g. same-named .NET classes from different namespaces in one
  // cluster scope) ARE one concept with multiple realizers. Pre-merge,
  // the second insertConcept silently superseded the first, losing a
  // node per collision pair (EnvisionWeb: 1,165 emitted → 1,153 live).
  const byConceptId = new Map<string, (typeof withIds)[number]>();
  for (const c of withIds) {
    const prior = byConceptId.get(c.conceptId);
    if (prior === undefined) {
      byConceptId.set(c.conceptId, c);
      continue;
    }
    byConceptId.set(c.conceptId, {
      ...prior,
      confidenceScore: Math.max(prior.confidenceScore, c.confidenceScore),
      realizedByElementIds: [
        ...new Set([...prior.realizedByElementIds, ...c.realizedByElementIds]),
      ].sort(),
      ...(prior.containsConceptNames !== undefined || c.containsConceptNames !== undefined
        ? {
            containsConceptNames: [
              ...new Set([
                ...(prior.containsConceptNames ?? []),
                ...(c.containsConceptNames ?? []),
              ]),
            ].sort(),
          }
        : {}),
      ...(prior.relatedToConceptNames !== undefined || c.relatedToConceptNames !== undefined
        ? {
            relatedToConceptNames: [
              ...new Set([
                ...(prior.relatedToConceptNames ?? []),
                ...(c.relatedToConceptNames ?? []),
              ]),
            ].sort(),
          }
        : {}),
      // Language stays only when the merged halves agree.
      ...(prior.language === c.language ? {} : { language: undefined }),
      // Fathom row 3.3.12: observable-support fields — keep the
      // higher-support reading on collision (same shape as the
      // confidenceScore max above; a merge should never LOSE evidence).
      ...(prior.distinctiveness !== undefined || c.distinctiveness !== undefined
        ? { distinctiveness: Math.max(prior.distinctiveness ?? 0, c.distinctiveness ?? 0) }
        : {}),
      ...(prior.dominanceSupport !== undefined || c.dominanceSupport !== undefined
        ? { dominanceSupport: Math.max(prior.dominanceSupport ?? 0, c.dominanceSupport ?? 0) }
        : {}),
    });
  }
  const filtered = [...byConceptId.values()];
  const mergedClaimCount = withIds.length - filtered.length;

  filtered.sort((a, b) => {
    if (b.confidenceScore !== a.confidenceScore) {
      return b.confidenceScore - a.confidenceScore;
    }
    const byKind = a.conceptKind.localeCompare(b.conceptKind);
    if (byKind !== 0) return byKind;
    return a.name.localeCompare(b.name);
  });

  return { concepts: filtered, rawCountsByKind, refusals, mergedClaimCount };
}
