/**
 * Domain-model overlay implementation. Writes one node per concept and
 * records four kinds of membership relationship onto it as
 * `analysis-disposition` edges (Fathom row 3.1.8.4, disposition-layer
 * §S7 — via the dispositions overlay's `recordDispositions`, authored
 * by THIS overlay's domain-scoped mutator per the substrate's 5.0.42
 * source-domain rule):
 *   - `realizedBy`      → L0 elements implementing the concept.
 *   - `containsConcept` → child concepts (bounded-context → its entities).
 *   - `partOfContext`   → bounded-context the concept lives in (at most one).
 *   - `relatedTo`       → other concepts referenced from this one.
 *
 * Wave 4 (3.1.8.4): the legacy per-kind membership edge family (raw
 * `realizedBy`/`containsConcept`/`partOfContext`/`relatedTo` edge
 * TYPES, wave 3a's coexistence period) is RETIRED. `analysis-disposition`
 * edges are now THE membership record — the four read APIs
 * (`realizedByEdges` / `containsConceptEdges` / `relatedToEdges` /
 * `partOfContextEdge`) filter `metadata.kinds` for the wanted kind,
 * NEVER the edge's `type` or `subtype`: a target present under more
 * than one kind collapses to ONE edge (see below), so subtype-equality
 * filtering would silently drop that edge from every API but its
 * primary kind's.
 *
 * The same-target multi-kind case (a concept pair carrying two of
 * containsConcept/partOfContext/relatedTo) collapses to ONE edge whose
 * `subtype` is the primary kind per PRIMARY_KIND_PRECEDENCE and whose
 * `metadata.kinds` carries all of them — no producer emits that shape
 * today (the CLI supplies none of the three concept-target inputs; no
 * detector emits contains/related names), but the public
 * `DomainConceptInput` admits it, so the overlay handles and pins it.
 */

import type { Edge, GraphLayer, GraphMutator, Node } from "@kepello/nodegraph-core";
import {
  ANALYSIS_DISPOSITION_EDGE_TYPE,
  makeDispositionOverlay,
  type DispositionCandidate,
  type DispositionOverlay,
  type PositiveKind,
} from "@kepello/nodegraph-dispositions";
import {
  DOMAIN_CONCEPT_DOMAIN,
  DOMAIN_CONCEPT_INDEXES,
  DOMAIN_CONCEPT_METADATA_KIND,
  DOMAIN_CONCEPT_METADATA_SCHEMA,
  DOMAIN_CONCEPT_SCHEMA_VERSION,
} from "./schema.js";
import type {
  ConceptKind,
  DomainConceptInput,
  DomainConceptMetadata,
  DomainConceptNode,
  DomainModelOverlay,
} from "./types.js";

export class DomainModelOverlayImpl implements DomainModelOverlay {
  private readonly mutator: GraphMutator<typeof DOMAIN_CONCEPT_DOMAIN>;
  /**
   * Wave 3a (3.1.8.4): disposition-layer overlay handle. Constructed
   * over the same graph — `registerOverlay` is idempotent (5.0.42), so
   * this coexists with the CLI's own disposition overlay instance. Its
   * edge writes are authored by THIS overlay's `domain-concept` mutator
   * (the caller-mutator contract; the disposition domain's own mutator
   * writes only reason/ledger nodes).
   */
  private readonly dispositions: DispositionOverlay;

  constructor(private readonly graph: GraphLayer) {
    // Per Fathom row 5.0.42: registerOverlay returns the domain-scoped mutator.
    this.mutator = this.graph.registerOverlay({
        domain: DOMAIN_CONCEPT_DOMAIN,
        schemaVersion: DOMAIN_CONCEPT_SCHEMA_VERSION,
        metadataSchema: DOMAIN_CONCEPT_METADATA_SCHEMA,
        indexes: DOMAIN_CONCEPT_INDEXES,
      });
    this.dispositions = makeDispositionOverlay(this.graph);
  }

  insertConcept(input: DomainConceptInput): DomainConceptNode {
    return this.graph.transaction(
      {
        kind: "insert-domain-concept",
        producerDomain: DOMAIN_CONCEPT_DOMAIN,
        summary: `insert domain concept ${input.conceptId} (${input.conceptKind})`,
      },
      () => this.doInsertConcept(input),
    ).result;
  }

  private doInsertConcept(input: DomainConceptInput): DomainConceptNode {
    const metadata = buildMetadata(input);
    const existing = this.graph.getLiveNodeByNaturalKey(
      DOMAIN_CONCEPT_DOMAIN,
      input.conceptId,
    );
    let node: Node;
    if (existing === undefined) {
      node = this.mutator.insertNode({
        domain: DOMAIN_CONCEPT_DOMAIN,
        naturalKey: input.conceptId,
        contentHash: input.contentHash,
        metadata: metadata as unknown,
      });
    } else if (existing.contentHash === input.contentHash) {
      node = existing;
    } else {
      node = this.mutator.supersedeNode(existing.id, {
        contentHash: input.contentHash,
        metadata: metadata as unknown,
      });
    }

    // Wave 4 (3.1.8.4): the `analysis-disposition` family is THE
    // membership record. Kinds map 1:1 from the four inputs; a target
    // present in more than one input merges kinds onto one edge
    // (pair-overlap case). `reconcileDispositions` also enforces
    // `partOfContext`'s at-most-one invariant — see its doc comment.
    const wanted = new Map<string, Set<PositiveKind>>();
    const want = (target: string, kind: PositiveKind): void => {
      let set = wanted.get(target);
      if (set === undefined) {
        set = new Set();
        wanted.set(target, set);
      }
      set.add(kind);
    };
    for (const t of input.realizedByElementIds) want(t, "realizedBy");
    for (const t of input.containsConceptIds ?? []) want(t, "containsConcept");
    for (const t of input.relatedToConceptIds ?? []) want(t, "relatedTo");
    if (input.partOfContextId !== undefined) {
      want(input.partOfContextId, "partOfContext");
    }
    this.reconcileDispositions(node.id, wanted);

    return asConcept(node);
  }

  /**
   * Bring the node's outgoing `analysis-disposition` edges to exactly
   * `wanted` (targetKey → kind set). THE membership-edge hygiene (Fathom
   * row 5.1.5.1, originally proved on the wave-4-retired legacy
   * membership family — this is now its sole implementation): a target
   * missing from `wanted` is tombstoned, so repeated re-emits with
   * shrinking sets (e.g. after a high-signal-kind filter lands) don't
   * accumulate live edges from prior runs that the overlay's own
   * contentHash-equality fast path would otherwise never clean up. One
   * addition beyond that hygiene: a target whose KIND SET changed is
   * tombstoned and re-emitted fresh, because `recordDispositions`' kind
   * merge is deliberately ADDITIVE (correct within one analyze; stale-kind
   * accumulation across re-runs would be this overlay's bug, not the
   * package's). Already-satisfied pairs are skipped entirely —
   * `recordDispositions` supersedes unconditionally on existing pairs,
   * and re-sending identical state every re-analyze would churn edge ids.
   *
   * Also enforces `partOfContext`'s at-most-one invariant (previously the
   * legacy family's own dedicated tombstone loop, walking every existing
   * `partOfContext`-typed edge regardless of target): within one
   * `insertConcept` call, `wanted` carries the `partOfContext` kind for
   * at most one target, so any existing edge carrying that kind for a
   * DIFFERENT target is either absent from `wanted` (tombstoned as
   * stale) or present under a different kind set (tombstoned and
   * re-emitted WITHOUT `partOfContext`) — a context reassignment always
   * MOVES the kind, never leaves two live. Pinned in
   * `overlay-dispositions.test.ts`.
   */
  private reconcileDispositions(
    nodeId: string,
    wanted: ReadonlyMap<string, ReadonlySet<PositiveKind>>,
  ): void {
    const existing = this.graph.edgesFrom(nodeId, {
      type: ANALYSIS_DISPOSITION_EDGE_TYPE,
      includeDangling: true,
    });
    const satisfied = new Set<string>();
    for (const e of existing) {
      const key = e.targetId ?? e.targetRef;
      if (key === null) continue;
      const wantedKinds = wanted.get(key);
      if (wantedKinds !== undefined && kindSetEquals(edgeKinds(e), wantedKinds)) {
        satisfied.add(key);
        continue;
      }
      // Stale target (5.1.5.1 mirror) or stale kind set — tombstone;
      // wanted pairs re-emit fresh below.
      this.mutator.tombstoneEdge(e.id);
    }
    const batch: DispositionCandidate[] = [];
    for (const [target, kinds] of wanted) {
      if (satisfied.has(target)) continue;
      // Same target resolution as emitEdge: resolved node id when the
      // target names a node, dangling targetRef otherwise — the two
      // families stay parallel per-target.
      const resolved = this.graph.getNodeById(target) !== undefined;
      for (const kind of kinds) {
        batch.push(
          resolved
            ? { sourceId: nodeId, targetId: target, kind }
            : { sourceId: nodeId, targetRef: target, kind },
        );
      }
    }
    if (batch.length > 0) {
      this.dispositions.recordDispositions(this.mutator, batch);
    }
  }

  renameConcept(conceptId: string, displayName: string): DomainConceptNode {
    return this.graph.transaction(
      {
        kind: "rename-domain-concept",
        producerDomain: DOMAIN_CONCEPT_DOMAIN,
        summary: `rename domain concept ${conceptId}`,
      },
      () =>
        this.supersedeWithMetadata(conceptId, (prior) => ({
          ...prior,
          displayName,
        })),
    ).result;
  }

  setEnrichment(
    conceptId: string,
    enrichment: DomainConceptMetadata["llmEnrichment"],
  ): DomainConceptNode {
    return this.graph.transaction(
      {
        kind: "set-concept-enrichment",
        producerDomain: DOMAIN_CONCEPT_DOMAIN,
        summary: `set llmEnrichment on concept ${conceptId}`,
      },
      () =>
        this.supersedeWithMetadata(conceptId, (prior) => ({
          ...prior,
          llmEnrichment: enrichment,
        })),
    ).result;
  }

  /**
   * Shared supersede helper for concept-metadata-only changes (rename,
   * enrichment writes). Reads the prior tip's outgoing
   * `analysis-disposition` edges, supersedes with the transformed
   * metadata, then re-emits the SAME (target, kind-set) pairs from the
   * new node UUID. Per Fathom row 5.0.39 — raw `supersedeNode` cascades
   * the prior tip's outgoing edges to tombstoned, so every metadata-only
   * supersede MUST re-emit edges to preserve identity.
   *
   * Wave 4 (3.1.8.4): this is now the ONLY edge family the overlay
   * emits — the legacy membership family this helper used to also
   * recapture (`realizedBy`/`relatedTo`/`partOfContext`/`containsConcept`
   * as raw edge types) was retired. (`containsConcept` was missing from
   * that legacy capture until wave 3a found it while extending capture
   * to this family — see overlay-dispositions.test.ts's regression pin.)
   */
  private supersedeWithMetadata(
    conceptId: string,
    transform: (prior: DomainConceptMetadata) => DomainConceptMetadata,
  ): DomainConceptNode {
    const existing = this.graph.getLiveNodeByNaturalKey(
      DOMAIN_CONCEPT_DOMAIN,
      conceptId,
    );
    if (existing === undefined) {
      throw new Error(`No live domain concept with conceptId=${conceptId}`);
    }
    const prior = existing.metadata as DomainConceptMetadata | null;
    if (prior === null) {
      throw new Error(`Domain concept ${conceptId} has no metadata`);
    }
    // Capture prior outgoing `analysis-disposition` edges BEFORE
    // supersede; the substrate's cascade will tombstone them.
    // (targetKey, kind set) per edge.
    const dispositionWanted = new Map<string, ReadonlySet<PositiveKind>>();
    for (const e of this.graph.edgesFrom(existing.id, {
      type: ANALYSIS_DISPOSITION_EDGE_TYPE,
      includeDangling: true,
    })) {
      const key = e.targetId ?? e.targetRef;
      if (key === null) continue;
      const kinds = edgeKinds(e);
      if (kinds.length > 0) dispositionWanted.set(key, new Set(kinds));
    }
    const next = transform(prior);
    const node = this.mutator.supersedeNode(existing.id, {
      contentHash: existing.contentHash,
      metadata: next as unknown,
    });
    this.reconcileDispositions(node.id, dispositionWanted);
    return asConcept(node);
  }

  tombstoneConcept(conceptId: string): void {
    this.graph.transaction(
      {
        kind: "tombstone-domain-concept",
        producerDomain: DOMAIN_CONCEPT_DOMAIN,
        summary: `tombstone domain concept ${conceptId}`,
      },
      () => {
        const existing = this.graph.getLiveNodeByNaturalKey(
          DOMAIN_CONCEPT_DOMAIN,
          conceptId,
        );
        if (existing === undefined) return;
        this.mutator.tombstoneNode(existing.id);
      },
    );
  }

  listConcepts(): DomainConceptNode[] {
    return this.graph
      .queryNodes({ domain: DOMAIN_CONCEPT_DOMAIN, lifecycleState: "live" })
      .map(asConcept);
  }

  getConcept(conceptId: string): DomainConceptNode | undefined {
    const node = this.graph.getLiveNodeByNaturalKey(
      DOMAIN_CONCEPT_DOMAIN,
      conceptId,
    );
    return node === undefined ? undefined : asConcept(node);
  }

  conceptsByKind(conceptKind: ConceptKind): DomainConceptNode[] {
    return this.listConcepts().filter(
      (n) => n.metadata.conceptKind === conceptKind,
    );
  }

  conceptsInCluster(clusterId: string): DomainConceptNode[] {
    return this.listConcepts().filter((n) => n.metadata.clusterId === clusterId);
  }

  realizedByEdges(conceptId: string): Edge[] {
    return this.dispositionEdgesOfKind(conceptId, "realizedBy");
  }

  containsConceptEdges(conceptId: string): Edge[] {
    return this.dispositionEdgesOfKind(conceptId, "containsConcept");
  }

  relatedToEdges(conceptId: string): Edge[] {
    return this.dispositionEdgesOfKind(conceptId, "relatedTo");
  }

  partOfContextEdge(conceptId: string): Edge | undefined {
    return this.dispositionEdgesOfKind(conceptId, "partOfContext")[0];
  }

  /**
   * Wave 4 (3.1.8.4): every membership read filters the node's
   * `analysis-disposition` edges on `metadata.kinds` CONTAINS `kind` —
   * never the edge's `type` (shared across all kinds) or `subtype` (the
   * PRIMARY kind only). A pair-overlap-merged edge (e.g. containsConcept
   * + relatedTo on one target) carries both kinds in `metadata.kinds`
   * but only one as `subtype`; filtering on `subtype` would silently
   * drop that edge from every API but its primary kind's.
   */
  private dispositionEdgesOfKind(conceptId: string, kind: PositiveKind): Edge[] {
    const node = this.graph.getLiveNodeByNaturalKey(
      DOMAIN_CONCEPT_DOMAIN,
      conceptId,
    );
    if (node === undefined) return [];
    return this.graph
      .edgesFrom(node.id, {
        type: ANALYSIS_DISPOSITION_EDGE_TYPE,
        includeDangling: true,
      })
      .filter((e) => edgeKinds(e).includes(kind));
  }
}

function buildMetadata(input: DomainConceptInput): DomainConceptMetadata {
  const meta: DomainConceptMetadata = {
    kind: DOMAIN_CONCEPT_METADATA_KIND,
    conceptId: input.conceptId,
    conceptKind: input.conceptKind,
    name: input.name,
    confidenceScore: input.confidenceScore,
    // Required, not optional (Fathom row 3.1.8.1) — see
    // `DomainConceptMetadata.evidenceProvenance`'s doc comment.
    evidenceProvenance: input.evidenceProvenance,
  };
  if (input.displayName !== undefined) meta.displayName = input.displayName;
  if (input.clusterId !== undefined) meta.clusterId = input.clusterId;
  if (input.language !== undefined) meta.language = input.language;
  // Fathom row 3.3.12 (overlay-confidence-honest-null-policy):
  // observable-support fields — persisted only when the caller
  // actually computed one (bounded-context / aggregate-root
  // respectively); absent for every other conceptKind, same
  // caller-opt-in shape as displayName/clusterId/language above.
  if (input.distinctiveness !== undefined) meta.distinctiveness = input.distinctiveness;
  if (input.dominanceSupport !== undefined) meta.dominanceSupport = input.dominanceSupport;
  return meta;
}

function asConcept(node: Node): DomainConceptNode {
  return node as DomainConceptNode;
}

/** Kinds carried on an `analysis-disposition` edge (`metadata.kinds`). */
function edgeKinds(edge: Edge): PositiveKind[] {
  const metadata = edge.metadata;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return [];
  }
  const kinds = (metadata as { kinds?: unknown }).kinds;
  return Array.isArray(kinds) ? (kinds as PositiveKind[]) : [];
}

function kindSetEquals(
  kinds: readonly PositiveKind[],
  wanted: ReadonlySet<PositiveKind>,
): boolean {
  if (kinds.length !== wanted.size) return false;
  for (const k of kinds) {
    if (!wanted.has(k)) return false;
  }
  return true;
}

export function makeDomainModelOverlay(graph: GraphLayer): DomainModelOverlay {
  return new DomainModelOverlayImpl(graph);
}
