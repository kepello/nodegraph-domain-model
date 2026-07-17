/**
 * Wave-3a positive-disposition tests (Fathom row 3.1.8.4, disposition-layer
 * §S7 wave 3a — domain-model slice). Pins:
 *
 *   - insertConcept ALSO emits `analysis-disposition` edges (via
 *     `recordDispositions` with THIS overlay's mutator) alongside the
 *     legacy membership edges — kinds map 1:1
 *     (`realizedBy`/`containsConcept`/`partOfContext`/`relatedTo`).
 *   - Membership edges STAY (both families coexist until wave 4).
 *   - PAIR-OVERLAP PIN (walkthrough Q1 applied to L7b): the overlay API
 *     admits the same target concept in two of
 *     {containsConceptIds, partOfContextId, relatedToConceptIds} — that
 *     pair's kinds merge onto ONE edge, subtype = primary kind per
 *     PRIMARY_KIND_PRECEDENCE (containsConcept < partOfContext < relatedTo).
 *     NO producer emits this shape today (the CLI passes none of the three
 *     inputs; no detector emits contains/related names) — the pin guards
 *     the API-level contract, not a production occurrence.
 *   - Stale-disposition hygiene mirrors membership's 5.1.5.1 fix:
 *     re-insert with a shrunken target set tombstones the stale
 *     disposition edge; a target whose KIND SET changed is re-emitted
 *     with exactly the new kinds (recordDispositions' additive merge must
 *     not accumulate stale kinds across runs).
 *   - Identical re-insert is churn-free (same edge ids — the overlay
 *     skips recordDispositions for already-satisfied pairs, because
 *     recordDispositions supersedes unconditionally on existing pairs).
 *   - renameConcept / setEnrichment preserve disposition edges through
 *     the metadata-only supersede (the 5.0.39 invariant extended to the
 *     new edge family).
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { GraphLayerImpl, type GraphLayer } from "@kepello/nodegraph-core";
import { InMemoryBackend } from "@kepello/nodegraph-core/in-memory";
import { ANALYSIS_DISPOSITION_EDGE_TYPE } from "@kepello/nodegraph-dispositions";
import {
  PART_OF_CONTEXT_EDGE_TYPE,
  REALIZED_BY_EDGE_TYPE,
  RELATED_TO_EDGE_TYPE,
  CONTAINS_CONCEPT_EDGE_TYPE,
} from "./types.js";
import { makeDomainModelOverlay } from "./overlay.js";

function makeGraph(): GraphLayer {
  return new GraphLayerImpl(new InMemoryBackend());
}

function dispositionEdges(graph: GraphLayer, nodeId: string) {
  return graph.edgesFrom(nodeId, {
    type: ANALYSIS_DISPOSITION_EDGE_TYPE,
    includeDangling: true,
  });
}

function edgeTargetKey(e: { targetId: string | null; targetRef: string | null }): string {
  return e.targetId ?? e.targetRef ?? "(none)";
}

function kindsOf(e: { metadata: unknown }): string[] {
  return ((e.metadata as { kinds?: string[] })?.kinds ?? []).slice();
}

test("insertConcept — emits analysis-disposition edges for all four kinds ALONGSIDE membership edges (both families coexist)", () => {
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  const node = overlay.insertConcept({
    conceptId: "c1",
    conceptKind: "bounded-context",
    name: "users",
    confidenceScore: 0.9,
    evidenceProvenance: "name",
    contentHash: "h1",
    realizedByElementIds: ["User", "UserRepo"],
    containsConceptIds: ["child-1"],
    partOfContextId: "ctx-parent",
    relatedToConceptIds: ["peer-1"],
  });

  // Membership edges STAY — wave 3a is additive.
  assert.equal(overlay.realizedByEdges("c1").length, 2, "realizedBy membership stays");
  assert.equal(overlay.containsConceptEdges("c1").length, 1, "containsConcept membership stays");
  assert.ok(overlay.partOfContextEdge("c1"), "partOfContext membership stays");
  assert.equal(overlay.relatedToEdges("c1").length, 1, "relatedTo membership stays");

  // Disposition edges: one per distinct target, kinds mapped 1:1.
  const edges = dispositionEdges(graph, node.id);
  const byTarget = new Map(edges.map((e) => [edgeTargetKey(e), e]));
  assert.equal(edges.length, 5, "5 distinct targets → 5 analysis-disposition edges");

  const user = byTarget.get("User");
  assert.ok(user, "realizedBy target has a disposition edge");
  assert.equal(user.subtype, "realizedBy");
  assert.deepEqual(kindsOf(user), ["realizedBy"]);

  const child = byTarget.get("child-1");
  assert.ok(child, "containsConcept target has a disposition edge");
  assert.equal(child.subtype, "containsConcept");
  assert.deepEqual(kindsOf(child), ["containsConcept"]);

  const parent = byTarget.get("ctx-parent");
  assert.ok(parent, "partOfContext target has a disposition edge");
  assert.equal(parent.subtype, "partOfContext");
  assert.deepEqual(kindsOf(parent), ["partOfContext"]);

  const peer = byTarget.get("peer-1");
  assert.ok(peer, "relatedTo target has a disposition edge");
  assert.equal(peer.subtype, "relatedTo");
  assert.deepEqual(kindsOf(peer), ["relatedTo"]);
});

test("PAIR-OVERLAP PIN — same target in containsConceptIds AND relatedToConceptIds merges to ONE edge, subtype containsConcept (precedence)", () => {
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  const node = overlay.insertConcept({
    conceptId: "bc",
    conceptKind: "bounded-context",
    name: "orders",
    confidenceScore: 0.9,
    evidenceProvenance: "name",
    contentHash: "h",
    realizedByElementIds: ["Order"],
    containsConceptIds: ["concept-x"],
    relatedToConceptIds: ["concept-x"],
  });
  const edges = dispositionEdges(graph, node.id).filter(
    (e) => edgeTargetKey(e) === "concept-x",
  );
  assert.equal(edges.length, 1, "ONE collapsed edge for the overlapping pair");
  assert.equal(edges[0]!.subtype, "containsConcept", "containsConcept(10) beats relatedTo(12)");
  assert.deepEqual(kindsOf(edges[0]!).sort(), ["containsConcept", "relatedTo"]);
});

test("PAIR-OVERLAP PIN — partOfContextId also in relatedToConceptIds merges to ONE edge, subtype partOfContext (precedence)", () => {
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  const node = overlay.insertConcept({
    conceptId: "e1",
    conceptKind: "entity",
    name: "Order",
    confidenceScore: 0.85,
    evidenceProvenance: "mixed",
    contentHash: "h",
    realizedByElementIds: ["Order"],
    partOfContextId: "ctx-orders",
    relatedToConceptIds: ["ctx-orders"],
  });
  const edges = dispositionEdges(graph, node.id).filter(
    (e) => edgeTargetKey(e) === "ctx-orders",
  );
  assert.equal(edges.length, 1, "ONE collapsed edge for the overlapping pair");
  assert.equal(edges[0]!.subtype, "partOfContext", "partOfContext(11) beats relatedTo(12)");
  assert.deepEqual(kindsOf(edges[0]!).sort(), ["partOfContext", "relatedTo"]);
});

test("re-insert with SHRUNKEN realizedBy set — stale disposition edge tombstoned (5.1.5.1 mirror for the new family)", () => {
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  const input = {
    conceptId: "c-shrink",
    conceptKind: "entity" as const,
    name: "User",
    confidenceScore: 0.85,
    evidenceProvenance: "mixed" as const,
    contentHash: "h1",
    realizedByElementIds: ["User", "UserImpl"],
  };
  const node = overlay.insertConcept(input);
  assert.equal(dispositionEdges(graph, node.id).length, 2);

  const node2 = overlay.insertConcept({
    ...input,
    realizedByElementIds: ["User"],
  });
  const after = dispositionEdges(graph, node2.id);
  assert.equal(after.length, 1, "stale disposition edge to UserImpl tombstoned");
  assert.equal(edgeTargetKey(after[0]!), "User");
});

test("re-insert with a target's KIND SET changed — edge carries exactly the new kinds (no stale-kind accumulation from the additive merge)", () => {
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  const base = {
    conceptId: "c-kindswap",
    conceptKind: "bounded-context" as const,
    name: "billing",
    confidenceScore: 0.9,
    evidenceProvenance: "name" as const,
    contentHash: "h1",
    realizedByElementIds: ["Invoice"],
  };
  overlay.insertConcept({ ...base, containsConceptIds: ["concept-y"] });
  const node2 = overlay.insertConcept({ ...base, relatedToConceptIds: ["concept-y"] });
  const edges = dispositionEdges(graph, node2.id).filter(
    (e) => edgeTargetKey(e) === "concept-y",
  );
  assert.equal(edges.length, 1);
  assert.deepEqual(
    kindsOf(edges[0]!),
    ["relatedTo"],
    "kinds reflect the CURRENT emission only — a merged ['containsConcept','relatedTo'] here is the stale-kind accumulation bug",
  );
  assert.equal(edges[0]!.subtype, "relatedTo");
});

test("identical re-insert — churn-free (same disposition edge ids; satisfied pairs skip recordDispositions' unconditional supersede)", () => {
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  const input = {
    conceptId: "c-stable",
    conceptKind: "entity" as const,
    name: "Account",
    confidenceScore: 0.85,
    evidenceProvenance: "mixed" as const,
    contentHash: "h",
    realizedByElementIds: ["Account"],
    partOfContextId: "ctx-a",
  };
  const a = overlay.insertConcept(input);
  const before = dispositionEdges(graph, a.id)
    .map((e) => e.id)
    .sort();
  const b = overlay.insertConcept(input);
  assert.equal(a.id, b.id, "content-hash fast path keeps the node");
  const after = dispositionEdges(graph, b.id)
    .map((e) => e.id)
    .sort();
  assert.deepEqual(after, before, "identical re-insert must not churn disposition edge ids");
});

test("renameConcept — PRESERVES analysis-disposition edges through the metadata-only supersede (5.0.39 invariant, new family)", () => {
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  overlay.insertConcept({
    conceptId: "c-rename",
    conceptKind: "entity",
    name: "User",
    confidenceScore: 0.85,
    evidenceProvenance: "mixed",
    contentHash: "h1",
    realizedByElementIds: ["User", "UserImpl"],
    partOfContextId: "ctx-users",
  });
  const renamed = overlay.renameConcept("c-rename", "Customer");
  const edges = dispositionEdges(graph, renamed.id);
  assert.equal(
    edges.length,
    3,
    "renameConcept lost analysis-disposition edges — the 5.0.39 supersede-cascade class of bug, new edge family",
  );
  const targets = edges.map(edgeTargetKey).sort();
  assert.deepEqual(targets, ["User", "UserImpl", "ctx-users"]);
});

test("setEnrichment — PRESERVES analysis-disposition edges (5.0.39 invariant, new family)", () => {
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  overlay.insertConcept({
    conceptId: "c-enrich",
    conceptKind: "bounded-context",
    name: "user-mgmt",
    confidenceScore: 0.9,
    evidenceProvenance: "name",
    contentHash: "h1",
    realizedByElementIds: ["User", "UserRepo"],
  });
  const enriched = overlay.setEnrichment("c-enrich", { name: "user-management" });
  assert.equal(
    dispositionEdges(graph, enriched.id).length,
    2,
    "setEnrichment lost analysis-disposition edges",
  );
});

test("REGRESSION — renameConcept preserves containsConcept MEMBERSHIP edges (pre-existing capture gap in supersedeWithMetadata)", () => {
  // supersedeWithMetadata captured realizedBy + relatedTo + partOfContext
  // but NOT containsConcept — renaming a bounded-context silently
  // stripped its containment membership. Found during the wave-3a
  // disposition re-emit work (the new family's capture covers all four
  // kinds; the membership family must agree).
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  overlay.insertConcept({
    conceptId: "bc-contains",
    conceptKind: "bounded-context",
    name: "orders",
    confidenceScore: 0.9,
    evidenceProvenance: "name",
    contentHash: "h1",
    realizedByElementIds: ["Order"],
    containsConceptIds: ["child-a", "child-b"],
  });
  assert.equal(overlay.containsConceptEdges("bc-contains").length, 2);
  overlay.renameConcept("bc-contains", "Order Management");
  assert.equal(
    overlay.containsConceptEdges("bc-contains").length,
    2,
    "renameConcept lost containsConcept membership edges — supersedeWithMetadata never captured them",
  );
});
