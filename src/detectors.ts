/**
 * Per-kind domain-concept detectors. Each consumes a `DomainContext`
 * and emits `ComputedConcept[]` for one DDD-style kind.
 *
 * Heuristics are deliberately conservative — v1 produces high-confidence
 * candidates and skips ambiguous cases. Operator-driven overrides
 * (via `.fathom/fathom.config.json` `domainModel.*`) handle the long
 * tail; refining detection precision is parked behind `l1b-role-stereotypes`
 * (3.1.1.2) which would give Wirfs-Brock role labels for sharper rules.
 */

import type { DomainContext, DomainClusterInfo, DomainElement } from "./context.js";
import type { ConceptKind } from "./types.js";

export interface ComputedConcept {
  conceptKind: ConceptKind;
  name: string;
  clusterId?: string;
  language?: string;
  confidenceScore: number;
  realizedByElementIds: readonly string[];
  containsConceptNames?: readonly string[];
  relatedToConceptNames?: readonly string[];
  /**
   * `bounded-context` only. Fathom row 3.3.12
   * (overlay-confidence-honest-null-policy): raw (unclamped) TF-IDF
   * vocabulary-distinctiveness ratio ∈ [0, 1] that feeds
   * `confidenceScore`'s saturating `min(0.3, distinctiveness*0.5)`
   * term. `confidenceScore` alone can't distinguish a cluster that
   * barely cleared the 0.6 saturation threshold from one at 1.0 — both
   * land on the same clamped score. This is the observable-support
   * signal that makes the ceiling legible instead of a silent mass
   * point.
   */
  distinctiveness?: number;
  /**
   * `aggregate-root` only. Fathom row 3.3.12
   * (overlay-confidence-honest-null-policy): total same-cluster
   * entity-to-entity inbound references the winning entity's dominance
   * ratio was computed over (`totalRefs`). `dominance =
   * best.count / totalRefs` is support-unweighted — a `totalRefs === 1`
   * cluster (a single reference, anywhere) forces dominance === 1.0
   * exactly like a cluster backed by dozens of references, and
   * `confidenceScore` alone can't tell them apart. `dominanceSupport`
   * makes a 0.9-from-1-edge read distinguishable from a
   * 0.9-from-many read.
   */
  dominanceSupport?: number;
}

const CLASS_KINDS: ReadonlySet<string> = new Set(["class", "struct"]);
/**
 * Fathom row 5.0.17: TS expresses many value objects as `interface`
 * declarations rather than classes (no methods, just shape). Including
 * interface + type-alias in the value-object pass surfaces them.
 */
const VALUE_SHAPE_KINDS: ReadonlySet<string> = new Set([
  "class",
  "struct",
  "interface",
  "type-alias",
]);
const FIELD_KINDS: ReadonlySet<string> = new Set(["field", "property"]);
const METHOD_KINDS: ReadonlySet<string> = new Set([
  "method", "function", "constructor", "accessor", "operator",
]);
/**
 * High-signal element kinds for `realizedBy` edges. Fathom row 5.1.5.1:
 * pre-fix, bounded-contexts emitted `realizedBy` to every element in
 * their cluster — parameters and type-parameters dominated the set,
 * shadowing the actual class/interface members in downstream
 * consumers (LLM-namer prompt rows, MCP responses). Now we filter to
 * elements that *meaningfully realize a concept*: classes, structs,
 * enums, interfaces, methods, functions, constructors. Parameters /
 * type-parameters / fields / variables / imports stay out — they're
 * substrate noise at this layer.
 */
const REALIZED_BY_KINDS: ReadonlySet<string> = new Set([
  "class",
  "struct",
  "enum",
  "interface",
  "type-alias",
  "method",
  "function",
  "constructor",
  "accessor",
  "operator",
]);

/**
 * Per-context derived indexes, built once and cached by context
 * identity (Fathom row 5.0.1.7 — sibling of the L6 fix 5.0.1.6).
 * Pre-fix `methodChildren` / `fieldChildren` did linear
 * `ctx.elements.find((e) => e.id === id)` per child inside detector
 * loops over every class, `classes()` re-`filter`ed all elements per
 * detector, and `detectAggregateRoots` did `ctx.clusters.find(...)`
 * per class. On EnvisionWeb (.NET, 85K elements, ~5000 classes, 1010
 * clusters) this made L7b `recoverDomainModel` the dominant L2-L7
 * sub-phase at 14s (34% of abstractions after the L6 fix).
 *
 * `recoverDomainModel` passes the SAME `DomainContext` to all five
 * detectors, so the index builds once per recover run and is reused.
 * WeakMap keyed by context identity — no `DomainContext` type change,
 * no caller change.
 */
interface ContextIndex {
  elementById: Map<string, DomainElement>;
  classList: DomainElement[];
  clusterById: Map<string, DomainClusterInfo>;
}
const contextIndexCache = new WeakMap<DomainContext, ContextIndex>();
function indexOf(ctx: DomainContext): ContextIndex {
  let idx = contextIndexCache.get(ctx);
  if (idx === undefined) {
    const elementById = new Map<string, DomainElement>();
    const classList: DomainElement[] = [];
    for (const e of ctx.elements) {
      elementById.set(e.id, e);
      if (CLASS_KINDS.has(e.kind)) classList.push(e);
    }
    const clusterById = new Map<string, DomainClusterInfo>();
    for (const c of ctx.clusters) clusterById.set(c.clusterId, c);
    idx = { elementById, classList, clusterById };
    contextIndexCache.set(ctx, idx);
  }
  return idx;
}

function classes(ctx: DomainContext): DomainElement[] {
  return indexOf(ctx).classList;
}

/**
 * Fathom row 5.0.26 (a): option-bag suffixes that indicate
 * configuration / input / output parameter shapes rather than DDD
 * value objects. A `MoneyOptions` is not a value object; it's an
 * argument bag. Round-5 pilot F8 surfaced 30+ such bags being
 * classified as value-objects in one cluster.
 */
const OPTION_BAG_SUFFIX_RE = /(Options|Input|Output|Metadata|Result|Args|Params|Config|Spec|State|Context|Snapshot|Summary|Counts|Counters|Stats|Report|Response|Request|Payload|Envelope|Update|Event|Message|Filter|Query|Mutation|Selector|Predicate|Builder|Factory)$/i;

/**
 * Fathom row 5.0.43 (round-8 F6): helper-module name suffix. Classes
 * named `*Helpers` or `*Helper` group loosely-related utility methods
 * and don't model a domain concept. Round-8 F6 surfaced `cognitivehelpers`,
 * `halsteadhelpers`, `intraclasshelpers`, `projectfilehelpers`, etc. as
 * bounded-contexts (false signal) and `cognitivehelpers` /
 * `analysishelpers` in `worst_rated` (Cohesion critical-veto fires on
 * disjoint-field-access, structurally correct but operator-misleading).
 *
 * Mirrors the L1 `helper-module` class stereotype in nodegraph-analysis
 * (the canonical signal). This local check is the L7b DDD-recovery
 * mirror of the same rule — kept package-local to avoid a peer-dep on
 * nodegraph-analysis (parallel to `isFixturePath` above, which mirrors
 * `isFixturePathString` for the same reason).
 */
const HELPER_MODULE_SUFFIX_RE = /Helpers?$/i;

function isHelperModule(el: DomainElement): boolean {
  return HELPER_MODULE_SUFFIX_RE.test(el.name);
}

/**
 * Fathom row 5.0.26 (b): pattern-match the element's source path
 * against fixture/test path conventions. Mirrors fathom-cli's L3
 * exclusion list (5.0.14 + 5.0.28 c) so DDD-recovery detectors don't
 * classify test fixtures as domain concepts. Round-5 pilot F9
 * surfaced `app` + `crosslangfixturestests` (both C# conformance
 * fixtures) misidentified as domain-services; F10 surfaced
 * `halsteadhelpers` (test helper) as the only "entity."
 *
 * Prefers `artifactId` (full file path) when present; falls back to
 * `id` (natural-key path) when not — the natural-key form embeds the
 * path with `:` separators (TS) or `/`/`\` (.NET / Windows). When
 * neither is path-shaped (e.g., short test-fixture ids like
 * `"halsteadhelpers"`), this returns false; callers that want
 * fixture exclusion in those cases supply `artifactId` explicitly.
 */
function isFixturePath(el: DomainElement): boolean {
  const haystack = el.artifactId ?? el.id;
  return (
    /[:\/\\]tests?[:\/\\]/i.test(haystack) ||
    /[:\/\\]fixtures[:\/\\]/i.test(haystack) ||
    /[:\/\\]testdata[:\/\\]/i.test(haystack) ||
    /[:\/\\]__tests__[:\/\\]/i.test(haystack) ||
    /[:\/\\]__mocks__[:\/\\]/i.test(haystack) ||
    /\.(test|spec)\.[a-z]+(#|$)/i.test(haystack) ||
    // (a) *-fixtures DIR segment (hyphenated fixture dirs, e.g.
    //     fathom-test-fixtures/). Trailing separator => DIR only;
    //     a bare *-fixtures.ts filename does NOT match (no trailing sep).
    //     Case-insensitive: kebab dir names have no casing convention.
    /[:\/\\][A-Za-z0-9._-]*-fixtures[:\/\\]/i.test(haystack) ||
    // (b) C# .Tests / .Test project DIR segment (capital-T anchored;
    //     xUnit / NUnit / MSTest project layout). Case-SENSITIVE:
    //     capital-T defeats production words like `.contest/`, `.latest/`
    //     that contain `test` as a lowercase substring. Lowercase
    //     `.tests/` is deliberately NOT matched (row 26 in the matrix).
    /[:\/\\][A-Za-z0-9._-]*\.Tests?[:\/\\]/.test(haystack) ||
    // (c) *Tests / *Test FILE suffix before .cs / .swift (PascalCase,
    //     capital-T anchored). Case-SENSITIVE: capital-T defeats
    //     `Latest.cs`, `ContestManager.cs`, `attestation.ts`.
    //     `meta.artifactId` is PascalCase-preserved so the anchor is safe.
    /[A-Za-z0-9]Tests?\.(cs|swift)(#|$)/.test(haystack)
  );
}

function methodChildren(ctx: DomainContext, classId: string): DomainElement[] {
  const ids = ctx.childrenOf.get(classId) ?? [];
  const byId = indexOf(ctx).elementById;
  return ids
    .map((id) => byId.get(id))
    .filter((e): e is DomainElement => e !== undefined && METHOD_KINDS.has(e.kind));
}

function fieldChildren(ctx: DomainContext, classId: string): DomainElement[] {
  const ids = ctx.childrenOf.get(classId) ?? [];
  const byId = indexOf(ctx).elementById;
  return ids
    .map((id) => byId.get(id))
    .filter((e): e is DomainElement => e !== undefined && FIELD_KINDS.has(e.kind));
}

/**
 * Entity — two paths:
 *
 *  - Classic: class / struct with L1 classStereotype `entity`.
 *  - TS / interface-shaped (Fathom 5.0.26 c): interface or type-alias
 *    with ≥ 3 field-shaped properties AND ≥ 1 implementor (inbound
 *    `extends`/`implements` edge) AND the name doesn't look like an
 *    option-bag suffix. The implementor signal distinguishes
 *    "structurally-typed entity" from "pure data shape" (which goes
 *    to value-object).
 *
 * Both paths reject test/fixture-pathed elements (5.0.26 b) and
 * option-bag-named elements (5.0.26 a).
 *
 * Confidence supplemented by field-count (entities typically carry
 * ≥ 1 field; ≥ 3 is more confidently entity-shaped).
 */
export function detectEntities(ctx: DomainContext): ComputedConcept[] {
  const out: ComputedConcept[] = [];
  const seenIds = new Set<string>();

  // Path 1 — classic class-stereotype entity OR large-class with
  // entity-shape (Fathom row 5.0.36). The L1 stereotype rule cascade
  // assigns `large-class` BEFORE `entity` (anti-pattern signal wins on
  // structural overload — methodCount > 20 or loc > 500). A class can
  // be both a god-class AND an entity: the anti-pattern stereotype
  // describes WHAT IT IS (oversized), the conceptKind describes WHAT IT
  // MODELS (a mutable domain object). Surfacing large-class as entity
  // doesn't suppress the anti-pattern signal — detection + ratings +
  // L6 patterns continue to flag the god-class separately.
  //
  // Entity-shape predicate (matches the L1 entity rule's structural
  // floor): ≥ 3 fields AND ≥ 3 method children. Confidence is dropped
  // by 0.1 for the large-class path to encode the secondary-match
  // signal — consumers can rank pure entities above god-class entities.
  for (const cls of classes(ctx)) {
    const stereo = ctx.classStereotypes.get(cls.id);
    if (stereo !== "entity" && stereo !== "large-class") continue;
    if (isFixturePath(cls)) continue;
    if (isHelperModule(cls)) continue; // Fathom 5.0.43 / round-8 F6
    if (OPTION_BAG_SUFFIX_RE.test(cls.name)) continue;
    const fields = fieldChildren(ctx, cls.id);
    const methods = methodChildren(ctx, cls.id);
    // Entity-shape gate (applied to both stereotypes — `entity` keeps
    // its own ≥1-field signal via the score-boost below; the gate here
    // only filters large-classes that lack structural-entity shape).
    if (stereo === "large-class" && (fields.length < 3 || methods.length < 3)) {
      continue;
    }
    let score = stereo === "large-class" ? 0.6 : 0.7;
    if (fields.length >= 1) score += 0.1;
    if (fields.length >= 3) score += 0.05;
    const clusterId = ctx.clusterByElement.get(cls.id);
    out.push({
      conceptKind: "entity",
      name: cls.name,
      clusterId,
      language: cls.language,
      confidenceScore: score,
      realizedByElementIds: [cls.id],
    });
    seenIds.add(cls.id);
  }

  // Path 2 — TS interface-shaped entity. Fathom row 5.0.26 (c).
  // Build inverse of inheritsEdges: target → sources that extend/implement it.
  const implementorsByTarget = new Map<string, number>();
  for (const [src, parents] of ctx.inheritsEdges) {
    void src;
    for (const target of parents) {
      implementorsByTarget.set(target, (implementorsByTarget.get(target) ?? 0) + 1);
    }
  }
  for (const el of ctx.elements) {
    if (el.kind !== "interface" && el.kind !== "type-alias") continue;
    if (seenIds.has(el.id)) continue;
    if (isFixturePath(el)) continue;
    if (isHelperModule(el)) continue; // Fathom 5.0.43 / round-8 F6
    if (OPTION_BAG_SUFFIX_RE.test(el.name)) continue;
    const fields = fieldChildren(ctx, el.id);
    if (fields.length < 3) continue;
    const methods = methodChildren(ctx, el.id);
    // Entity-shape: has methods OR has implementors. Pure-data
    // interfaces (no methods, no implementors) go to value-object.
    const implementors = implementorsByTarget.get(el.id) ?? 0;
    const hasEntityShape = methods.length > 0 || implementors > 0;
    if (!hasEntityShape) continue;
    let score = 0.6;
    if (fields.length >= 5) score += 0.1;
    if (implementors >= 2) score += 0.05;
    out.push({
      conceptKind: "entity",
      name: el.name,
      clusterId: ctx.clusterByElement.get(el.id),
      language: el.language,
      confidenceScore: score,
      realizedByElementIds: [el.id],
    });
    seenIds.add(el.id);
  }

  return out;
}

/**
 * Value object — two paths:
 *
 *  - Classic: class / struct with L1 classStereotype `data-class` AND
 *    no mutator-shaped method children.
 *  - TS / interface-shaped (Fathom 5.0.17): interface or type-alias
 *    with ≥ 2 field-shaped properties and no method children. TS
 *    expresses many domain value objects as interfaces (no methods,
 *    just shape) — `data-class` stereotype is impossible for
 *    interfaces because the stereotype derivation short-circuits to
 *    `interface` at the top of the rule cascade.
 *
 * Lower confidence than entities because the data-class /
 * shape-only combination has more false positives.
 */
export function detectValueObjects(ctx: DomainContext): ComputedConcept[] {
  const out: ComputedConcept[] = [];
  const seenIds = new Set<string>();

  // Path 1 — classic data-class.
  for (const cls of classes(ctx)) {
    const stereo = ctx.classStereotypes.get(cls.id);
    if (stereo !== "data-class") continue;
    if (isFixturePath(cls)) continue;
    if (isHelperModule(cls)) continue; // Fathom 5.0.43 / round-8 F6
    if (OPTION_BAG_SUFFIX_RE.test(cls.name)) continue;
    const methods = methodChildren(ctx, cls.id);
    const hasMutator = methods.some(
      (m) => ctx.methodStereotypes.get(m.id) === "mutator-shaped",
    );
    if (hasMutator) continue;
    const fields = fieldChildren(ctx, cls.id);
    let score = 0.7;
    if (fields.length >= 1) score += 0.1;
    if (methods.length <= 3) score += 0.05;
    out.push({
      conceptKind: "value-object",
      name: cls.name,
      clusterId: ctx.clusterByElement.get(cls.id),
      language: cls.language,
      confidenceScore: score,
      realizedByElementIds: [cls.id],
    });
    seenIds.add(cls.id);
  }

  // Path 2 — interface / type-alias shape (Fathom 5.0.17).
  // Fathom 5.0.26 (a): reject option-bag names — `*Options`,
  // `*Input`, `*Metadata`, etc. are configuration shapes, not DDD
  // value objects.
  // Fathom 5.0.26 (b): reject fixture/test-path elements.
  for (const el of ctx.elements) {
    if (!VALUE_SHAPE_KINDS.has(el.kind)) continue;
    if (CLASS_KINDS.has(el.kind)) continue; // already handled above
    if (seenIds.has(el.id)) continue;
    if (isFixturePath(el)) continue;
    if (isHelperModule(el)) continue; // Fathom 5.0.43 / round-8 F6
    if (OPTION_BAG_SUFFIX_RE.test(el.name)) continue;
    const fields = fieldChildren(ctx, el.id);
    if (fields.length < 2) continue;
    const methods = methodChildren(ctx, el.id);
    if (methods.length > 0) continue; // pure shape only
    let score = 0.6;
    if (fields.length >= 3) score += 0.1;
    if (fields.length >= 5) score += 0.05;
    out.push({
      conceptKind: "value-object",
      name: el.name,
      clusterId: ctx.clusterByElement.get(el.id),
      language: el.language,
      confidenceScore: score,
      realizedByElementIds: [el.id],
    });
  }

  return out;
}

/**
 * Aggregate root — entity with the most references to other entities
 * in the same cluster. One per cluster, fired only when the cluster
 * has ≥ 2 entities (singleton-entity clusters are entities, not
 * aggregates). Confidence reflects dominance of has-many references.
 */
export function detectAggregateRoots(
  ctx: DomainContext,
  entities: readonly ComputedConcept[],
): ComputedConcept[] {
  const entityIds = new Set<string>();
  const entityByClass = new Map<string, ComputedConcept>();
  for (const e of entities) {
    for (const id of e.realizedByElementIds) {
      entityIds.add(id);
      entityByClass.set(id, e);
    }
  }
  // Group entities by cluster.
  const entitiesByCluster = new Map<string, ComputedConcept[]>();
  for (const e of entities) {
    if (e.clusterId === undefined) continue;
    let list = entitiesByCluster.get(e.clusterId);
    if (list === undefined) {
      list = [];
      entitiesByCluster.set(e.clusterId, list);
    }
    list.push(e);
  }
  // Count entity-to-entity references per source-entity per cluster.
  const inboundCount = new Map<string, number>(); // class id → count of incoming refs from same-cluster entities
  for (const edge of ctx.referencesEdges) {
    if (!entityIds.has(edge.source) || !entityIds.has(edge.target)) continue;
    const srcConcept = entityByClass.get(edge.source);
    const tgtConcept = entityByClass.get(edge.target);
    if (srcConcept === undefined || tgtConcept === undefined) continue;
    if (srcConcept.clusterId !== tgtConcept.clusterId) continue;
    if (edge.source === edge.target) continue;
    inboundCount.set(edge.target, (inboundCount.get(edge.target) ?? 0) + 1);
  }
  const out: ComputedConcept[] = [];
  for (const [clusterId, members] of entitiesByCluster) {
    if (members.length < 2) continue;
    // Pick the entity with the highest inbound count.
    let best: { concept: ComputedConcept; count: number } | undefined;
    for (const member of members) {
      for (const classId of member.realizedByElementIds) {
        const count = inboundCount.get(classId) ?? 0;
        if (best === undefined || count > best.count) {
          best = { concept: member, count };
        }
      }
    }
    if (best === undefined) continue;
    if (best.count === 0) continue; // no inbound refs → no clear root
    const totalRefs = [...inboundCount.entries()]
      .filter(([id]) => {
        const c = entityByClass.get(id);
        return c?.clusterId === clusterId;
      })
      .reduce((acc, [, n]) => acc + n, 0);
    const dominance = totalRefs === 0 ? 0 : best.count / totalRefs;
    const score = Math.min(0.9, 0.6 + dominance * 0.3);
    out.push({
      conceptKind: "aggregate-root",
      name: best.concept.name,
      clusterId,
      language: best.concept.language,
      confidenceScore: score,
      realizedByElementIds: best.concept.realizedByElementIds,
      // Fathom row 3.3.12: support-aware observable field — see
      // ComputedConcept.dominanceSupport's doc comment.
      dominanceSupport: totalRefs,
    });
  }
  return out;
}

/**
 * Domain service — class with L1 classStereotype `controller` or
 * `command`, few/no field children (≤ 2), and a non-adapter cluster
 * (best-effort: avoid clusters named like "adapter"/"gateway").
 */
export function detectDomainServices(ctx: DomainContext): ComputedConcept[] {
  const out: ComputedConcept[] = [];
  for (const cls of classes(ctx)) {
    const stereo = ctx.classStereotypes.get(cls.id);
    if (stereo !== "controller" && stereo !== "command") continue;
    // Fathom 5.0.26 (b): reject fixture/test-pathed classes — round-5
    // F9 caught `app` + `crosslangfixturestests` (C# conformance
    // fixtures) being misidentified as domain-services.
    if (isFixturePath(cls)) continue;
    // Fathom 5.0.43 / round-8 F6: reject helper-module name suffix.
    if (isHelperModule(cls)) continue;
    // Fathom 5.0.26 (a): reject option-bag-named classes.
    if (OPTION_BAG_SUFFIX_RE.test(cls.name)) continue;
    const fields = fieldChildren(ctx, cls.id);
    if (fields.length > 2) continue;
    const methods = methodChildren(ctx, cls.id);
    if (methods.length === 0) continue;
    const clusterId = ctx.clusterByElement.get(cls.id);
    // Skip adapter-flavored clusters; they're infrastructure, not domain.
    if (clusterId !== undefined) {
      const cluster = indexOf(ctx).clusterById.get(clusterId);
      if (cluster !== undefined && /(adapter|gateway|client)/i.test(cluster.name)) {
        continue;
      }
    }
    let score = 0.65;
    if (fields.length === 0) score += 0.1;
    if (methods.length >= 3) score += 0.05;
    out.push({
      conceptKind: "domain-service",
      name: cls.name,
      clusterId,
      language: cls.language,
      confidenceScore: score,
      realizedByElementIds: [cls.id],
    });
  }
  return out;
}

/**
 * Bounded context — L3 cluster with ≥ `minClusterSize` members
 * (default 3), ≥ `minVocabularySize` distinct identifier terms
 * (default 5), and distinctive identifier vocabulary (the cluster has
 * terms not widely present in other clusters; default ratio ≥ 0.4).
 *
 * Returns one `bounded-context` concept per qualifying cluster.
 *
 * Thresholds tightened 2026-05-15 per Fathom row 3.2.4: original
 * `distinctiveness < 0.2` filter flagged 313 of 578 clusters as
 * bounded contexts on the Fathom workspace because the threshold was
 * too permissive at the call-edge-sparse end of the distribution and
 * no minimum-vocabulary floor existed. New defaults: distinctiveness
 * ≥ 0.4 + ≥ 5 distinct terms. Both are configurable for downstream
 * workloads.
 *
 * No layer-integrity check (Fathom row 3.3.12,
 * overlay-confidence-honest-null-policy): a prior `layerOk` gate
 * documented "uniform layer assignment when L4 has run" but
 * `DomainContext.layerByCluster` is one layer number PER CLUSTER, not
 * per member — there is no per-member data this function could ever
 * compare, so the gate was structurally unable to fail. It initialized
 * `true` and was never set `false`, silently contributing a constant
 * +0.1 to every score as if it were a real signal. Deleted outright
 * rather than implemented: a real per-member layer-integrity check
 * would require widening `DomainContext` to carry per-element layer
 * assignments, which is out of scope for a confidence-scoring fix.
 */
export function detectBoundedContexts(
  ctx: DomainContext,
  options: {
    minClusterSize?: number;
    minVocabularySize?: number;
    minDistinctiveness?: number;
  } = {},
): ComputedConcept[] {
  const minSize = options.minClusterSize ?? 3;
  const minVocab = options.minVocabularySize ?? 5;
  const minDistinctiveness = options.minDistinctiveness ?? 0.4;
  if (ctx.clusters.length === 0) return [];

  // Build per-cluster term frequencies from member element names.
  const elementsByCluster = new Map<string, DomainElement[]>();
  for (const e of ctx.elements) {
    const cid = ctx.clusterByElement.get(e.id);
    if (cid === undefined) continue;
    let list = elementsByCluster.get(cid);
    if (list === undefined) {
      list = [];
      elementsByCluster.set(cid, list);
    }
    list.push(e);
  }

  const termFreqByCluster = new Map<string, Map<string, number>>();
  const documentFrequency = new Map<string, number>();
  for (const [clusterId, members] of elementsByCluster) {
    const tf = new Map<string, number>();
    for (const m of members) {
      for (const term of splitIdentifier(m.name)) {
        tf.set(term, (tf.get(term) ?? 0) + 1);
      }
    }
    termFreqByCluster.set(clusterId, tf);
    for (const term of tf.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const totalClusters = elementsByCluster.size;
  const out: ComputedConcept[] = [];
  for (const cluster of ctx.clusters) {
    const members = elementsByCluster.get(cluster.clusterId) ?? [];
    if (members.length < minSize) continue;

    // Vocabulary distinctiveness: ratio of cluster-unique terms.
    const tf = termFreqByCluster.get(cluster.clusterId) ?? new Map();
    if (tf.size < minVocab) continue;
    let uniqueTerms = 0;
    for (const term of tf.keys()) {
      const df = documentFrequency.get(term) ?? 0;
      if (df === 1) uniqueTerms += 1;
    }
    const distinctiveness = tf.size === 0 ? 0 : uniqueTerms / tf.size;
    if (distinctiveness < minDistinctiveness) continue;

    // confidenceScore's ceiling is now 0.9 (was 1.0 pre-3.3.12; the
    // deleted layerOk gate contributed a constant, unearned +0.1). The
    // distinctiveness term itself still saturates at distinctiveness ≥
    // 0.6 (min(0.3, distinctiveness*0.5)) — any cluster clearing that
    // floor with ≥5 members lands on the same 0.9. `distinctiveness`
    // is persisted below as the observable-support field that keeps
    // that mass point legible (Fathom row 3.3.12).
    let score = 0.5;
    score += Math.min(0.3, distinctiveness * 0.5);
    if (members.length >= 5) score += 0.1;

    // Fathom row 5.1.5.1: filter realizedBy to high-signal kinds so
    // downstream consumers (Haiku-namer prompts, MCP responses) see
    // the classes/interfaces/methods that actually realize the
    // bounded-context, not parameter/type-param noise.
    const realizedBy = members.filter((m) => REALIZED_BY_KINDS.has(m.kind));
    if (realizedBy.length === 0) continue;

    // Fathom row 5.0.43 / round-8 F6: skip clusters whose class-kind
    // realizedBy elements are ALL helper-modules (name suffix
    // `Helpers?`). Round-8 F6 surfaced 4+ such clusters as
    // bounded-contexts (e.g., `cluster-halsteadhelpers`,
    // `cluster-cognitivehelpers/state`) — they're code-organization
    // partials in the dotnet analyzer host, not domain concepts.
    // Method/function/etc. realizedBy members are not gated on this
    // (helper-module is class-only); the class-kind dominance is what
    // signals "this cluster IS a helper module."
    const classKindMembers = realizedBy.filter((m) => CLASS_KINDS.has(m.kind));
    if (
      classKindMembers.length > 0 &&
      classKindMembers.every((m) => isHelperModule(m))
    ) {
      continue;
    }

    out.push({
      conceptKind: "bounded-context",
      name: cluster.displayName ?? cluster.name,
      clusterId: cluster.clusterId,
      language: uniformLanguage(members),
      // No `Math.min(1, ...)` clamp: the formula's max attainable value
      // is 0.5 + 0.3 + 0.1 = 0.9 (layerOk's constant +0.1 removed —
      // Fathom row 3.3.12), so a clamp against 1 is now always a no-op.
      confidenceScore: score,
      realizedByElementIds: realizedBy.map((m) => m.id),
      // Fathom row 3.3.12: support-aware observable field — see
      // ComputedConcept.distinctiveness's doc comment.
      distinctiveness,
    });
  }
  return out;
}

function uniformLanguage(elements: readonly DomainElement[]): string | undefined {
  const languages = new Set<string>();
  for (const e of elements) {
    if (e.language !== undefined) languages.add(e.language);
  }
  return languages.size === 1 ? [...languages][0] : undefined;
}

// Local stopword-light identifier splitter; duplicates the cluster overlay's
// helper rather than peer-depping. Kept private to this module.
function splitIdentifier(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 1);
}
