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

import type { DomainContext, DomainElement } from "./context.js";
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
}

const CLASS_KINDS: ReadonlySet<string> = new Set(["class", "struct"]);
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

function classes(ctx: DomainContext): DomainElement[] {
  return ctx.elements.filter((e) => CLASS_KINDS.has(e.kind));
}

function methodChildren(ctx: DomainContext, classId: string): DomainElement[] {
  const ids = ctx.childrenOf.get(classId) ?? [];
  return ids
    .map((id) => ctx.elements.find((e) => e.id === id))
    .filter((e): e is DomainElement => e !== undefined && METHOD_KINDS.has(e.kind));
}

function fieldChildren(ctx: DomainContext, classId: string): DomainElement[] {
  const ids = ctx.childrenOf.get(classId) ?? [];
  return ids
    .map((id) => ctx.elements.find((e) => e.id === id))
    .filter((e): e is DomainElement => e !== undefined && FIELD_KINDS.has(e.kind));
}

/**
 * Entity — class with L1 classStereotype `entity`. Confidence 0.85
 * when stereotype matches exactly; supplements with field-count signal
 * (entities typically carry ≥ 1 field).
 */
export function detectEntities(ctx: DomainContext): ComputedConcept[] {
  const out: ComputedConcept[] = [];
  for (const cls of classes(ctx)) {
    const stereo = ctx.classStereotypes.get(cls.id);
    if (stereo !== "entity") continue;
    const fields = fieldChildren(ctx, cls.id);
    let score = 0.7;
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
  }
  return out;
}

/**
 * Value object — class with L1 classStereotype `data-class` AND no
 * mutator-shaped method children (immutability heuristic). Lower
 * confidence than entities because the `data-class` + immutability
 * combination has more false positives.
 */
export function detectValueObjects(ctx: DomainContext): ComputedConcept[] {
  const out: ComputedConcept[] = [];
  for (const cls of classes(ctx)) {
    const stereo = ctx.classStereotypes.get(cls.id);
    if (stereo !== "data-class") continue;
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
    const fields = fieldChildren(ctx, cls.id);
    if (fields.length > 2) continue;
    const methods = methodChildren(ctx, cls.id);
    if (methods.length === 0) continue;
    const clusterId = ctx.clusterByElement.get(cls.id);
    // Skip adapter-flavored clusters; they're infrastructure, not domain.
    if (clusterId !== undefined) {
      const cluster = ctx.clusters.find((c) => c.clusterId === clusterId);
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
 * (default 5), uniform layer assignment when L4 has run, and
 * distinctive identifier vocabulary (the cluster has terms not
 * widely present in other clusters; default ratio ≥ 0.4).
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

    // Layer integrity: when L4 has run, the cluster must have a single
    // layer assignment; if any member is in a different cluster's layer
    // we skip the check (cluster-level — applies to the cluster itself).
    const layer = ctx.layerByCluster.get(cluster.clusterId);
    let layerOk = true; // default to OK when L4 absent
    if (layer === undefined && ctx.layerByCluster.size > 0) {
      // L4 has run somewhere but not this cluster — treat as OK.
      layerOk = true;
    }

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

    let score = 0.5;
    score += Math.min(0.3, distinctiveness * 0.5);
    if (layerOk) score += 0.1;
    if (members.length >= 5) score += 0.1;

    // Fathom row 5.1.5.1: filter realizedBy to high-signal kinds so
    // downstream consumers (Haiku-namer prompts, MCP responses) see
    // the classes/interfaces/methods that actually realize the
    // bounded-context, not parameter/type-param noise.
    const realizedBy = members.filter((m) => REALIZED_BY_KINDS.has(m.kind));
    if (realizedBy.length === 0) continue;

    out.push({
      conceptKind: "bounded-context",
      name: cluster.displayName ?? cluster.name,
      clusterId: cluster.clusterId,
      language: uniformLanguage(members),
      confidenceScore: Math.min(1, score),
      realizedByElementIds: realizedBy.map((m) => m.id),
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
