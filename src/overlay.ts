/**
 * Domain-model overlay implementation. Writes one node per concept
 * with outgoing edges:
 *   - `realizedBy`     → L0 elements implementing the concept.
 *   - `containsConcept` → child concepts (bounded-context → its entities).
 *   - `partOfContext`   → bounded-context the concept lives in (at most one).
 *   - `relatedTo`       → other concepts referenced from this one.
 */

import type { Edge, GraphLayer, GraphMutator, Node } from "@kepello/nodegraph-core";
import {
  DOMAIN_CONCEPT_DOMAIN,
  DOMAIN_CONCEPT_INDEXES,
  DOMAIN_CONCEPT_METADATA_KIND,
  DOMAIN_CONCEPT_METADATA_SCHEMA,
  DOMAIN_CONCEPT_SCHEMA_VERSION,
} from "./schema.js";
import {
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

export class DomainModelOverlayImpl implements DomainModelOverlay {
  private readonly mutator: GraphMutator<typeof DOMAIN_CONCEPT_DOMAIN>;

  constructor(private readonly graph: GraphLayer) {
    // Per Fathom row 5.0.42: registerOverlay returns the domain-scoped mutator.
    this.mutator = this.graph.registerOverlay({
        domain: DOMAIN_CONCEPT_DOMAIN,
        schemaVersion: DOMAIN_CONCEPT_SCHEMA_VERSION,
        metadataSchema: DOMAIN_CONCEPT_METADATA_SCHEMA,
        indexes: DOMAIN_CONCEPT_INDEXES,
      });
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

    this.emitMembership(node.id, input.realizedByElementIds, REALIZED_BY_EDGE_TYPE);
    this.emitMembership(
      node.id,
      input.containsConceptIds ?? [],
      CONTAINS_CONCEPT_EDGE_TYPE,
    );
    this.emitMembership(
      node.id,
      input.relatedToConceptIds ?? [],
      RELATED_TO_EDGE_TYPE,
    );

    // partOfContext — at most one. Tombstone any drift.
    const existingContext = this.graph.edgesFrom(node.id, {
      type: PART_OF_CONTEXT_EDGE_TYPE,
      includeDangling: true,
    });
    let hasContext = false;
    for (const e of existingContext) {
      const matches =
        input.partOfContextId !== undefined &&
        (e.targetId === input.partOfContextId ||
          e.targetRef === input.partOfContextId);
      if (matches) hasContext = true;
      else this.mutator.tombstoneEdge(e.id);
    }
    if (!hasContext && input.partOfContextId !== undefined) {
      this.emitEdge(node.id, input.partOfContextId, PART_OF_CONTEXT_EDGE_TYPE);
    }

    return asConcept(node);
  }

  private emitMembership(
    sourceId: string,
    targets: readonly string[],
    edgeType: string,
  ): void {
    const existing = this.graph.edgesFrom(sourceId, {
      type: edgeType,
      includeDangling: true,
    });
    const existingTargets = new Set<string>();
    const existingEdgeByTarget = new Map<string, string>();
    for (const e of existing) {
      const key = e.targetId ?? e.targetRef;
      if (key === null) continue;
      existingTargets.add(key);
      existingEdgeByTarget.set(key, e.id);
    }
    const wantedTargets = new Set(targets);
    // Fathom row 5.1.5.1: tombstone stale outgoing edges whose target
    // isn't in the new emission. Without this, repeated re-emits with
    // shrinking realizedBy sets (e.g., after the high-signal-kind filter
    // landed) accumulate live edges from prior runs — the overlay's
    // own contentHash-equality fast-path means no supersede fires and
    // the substrate cascade can't clean up.
    for (const [target, edgeId] of existingEdgeByTarget) {
      if (!wantedTargets.has(target)) {
        this.mutator.tombstoneEdge(edgeId);
      }
    }
    for (const target of targets) {
      if (existingTargets.has(target)) continue;
      this.emitEdge(sourceId, target, edgeType);
    }
  }

  private emitEdge(sourceId: string, target: string, edgeType: string): void {
    const byId = this.graph.getNodeById(target);
    if (byId !== undefined) {
      this.mutator.insertEdge({ sourceId, targetId: target, type: edgeType });
    } else {
      this.mutator.insertEdge({ sourceId, targetRef: target, type: edgeType });
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
   * enrichment writes). Reads the prior tip's outgoing `realizedBy` +
   * `partOfContext` + `relatedTo` edges, supersedes with the
   * transformed metadata, then re-emits the SAME edge set from the
   * new node UUID. Per Fathom row 5.0.39 — raw `supersedeNode`
   * cascades the prior tip's outgoing edges to tombstoned, so every
   * metadata-only supersede MUST re-emit edges to preserve identity.
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
    // Capture prior outgoing edge targets BEFORE supersede; the
    // substrate's cascade will tombstone them. Re-emitted from the
    // new tip identically after supersede.
    const captureTargets = (edgeType: string): string[] => {
      const out: string[] = [];
      for (const e of this.graph.edgesFrom(existing.id, {
        type: edgeType,
        includeDangling: true,
      })) {
        const key = e.targetId ?? e.targetRef;
        if (key !== null) out.push(key);
      }
      return out;
    };
    const realizedBy = captureTargets(REALIZED_BY_EDGE_TYPE);
    const relatedTo = captureTargets(RELATED_TO_EDGE_TYPE);
    const partOfContext = captureTargets(PART_OF_CONTEXT_EDGE_TYPE);
    const next = transform(prior);
    const node = this.mutator.supersedeNode(existing.id, {
      contentHash: existing.contentHash,
      metadata: next as unknown,
    });
    for (const t of realizedBy) this.emitEdge(node.id, t, REALIZED_BY_EDGE_TYPE);
    for (const t of relatedTo) this.emitEdge(node.id, t, RELATED_TO_EDGE_TYPE);
    for (const t of partOfContext)
      this.emitEdge(node.id, t, PART_OF_CONTEXT_EDGE_TYPE);
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
    const node = this.graph.getLiveNodeByNaturalKey(
      DOMAIN_CONCEPT_DOMAIN,
      conceptId,
    );
    if (node === undefined) return [];
    return this.graph.edgesFrom(node.id, {
      type: REALIZED_BY_EDGE_TYPE,
      includeDangling: true,
    });
  }

  containsConceptEdges(conceptId: string): Edge[] {
    const node = this.graph.getLiveNodeByNaturalKey(
      DOMAIN_CONCEPT_DOMAIN,
      conceptId,
    );
    if (node === undefined) return [];
    return this.graph.edgesFrom(node.id, {
      type: CONTAINS_CONCEPT_EDGE_TYPE,
      includeDangling: true,
    });
  }

  relatedToEdges(conceptId: string): Edge[] {
    const node = this.graph.getLiveNodeByNaturalKey(
      DOMAIN_CONCEPT_DOMAIN,
      conceptId,
    );
    if (node === undefined) return [];
    return this.graph.edgesFrom(node.id, {
      type: RELATED_TO_EDGE_TYPE,
      includeDangling: true,
    });
  }

  partOfContextEdge(conceptId: string): Edge | undefined {
    const node = this.graph.getLiveNodeByNaturalKey(
      DOMAIN_CONCEPT_DOMAIN,
      conceptId,
    );
    if (node === undefined) return undefined;
    return this.graph.edgesFrom(node.id, {
      type: PART_OF_CONTEXT_EDGE_TYPE,
      includeDangling: true,
    })[0];
  }
}

function buildMetadata(input: DomainConceptInput): DomainConceptMetadata {
  const meta: DomainConceptMetadata = {
    kind: DOMAIN_CONCEPT_METADATA_KIND,
    conceptId: input.conceptId,
    conceptKind: input.conceptKind,
    name: input.name,
    confidenceScore: input.confidenceScore,
  };
  if (input.displayName !== undefined) meta.displayName = input.displayName;
  if (input.clusterId !== undefined) meta.clusterId = input.clusterId;
  if (input.language !== undefined) meta.language = input.language;
  return meta;
}

function asConcept(node: Node): DomainConceptNode {
  return node as DomainConceptNode;
}

export function makeDomainModelOverlay(graph: GraphLayer): DomainModelOverlay {
  return new DomainModelOverlayImpl(graph);
}
