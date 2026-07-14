/**
 * Domain-model overlay tests. Pins:
 *
 *   - registerOverlay idempotent.
 *   - insertConcept persists metadata + realizedBy + partOfContext + relatedTo edges.
 *   - insertConcept idempotent on identical content-hash.
 *   - renameConcept preserves identity.
 *   - tombstoneConcept removes from list.
 *   - conceptsByKind / conceptsInCluster filters.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { GraphLayerImpl, type GraphLayer } from "@kepello/nodegraph-core";
import { InMemoryBackend } from "@kepello/nodegraph-core/in-memory";
import {
  DOMAIN_CONCEPT_DOMAIN,
  DOMAIN_CONCEPT_METADATA_KIND,
} from "./schema.js";
import {
  PART_OF_CONTEXT_EDGE_TYPE,
  REALIZED_BY_EDGE_TYPE,
  RELATED_TO_EDGE_TYPE,
} from "./types.js";
import {
  DomainModelOverlayImpl,
  makeDomainModelOverlay,
} from "./overlay.js";

function makeGraph(): GraphLayer {
  return new GraphLayerImpl(new InMemoryBackend());
}

test("registerOverlay — idempotent on repeated construction", () => {
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  assert.doesNotThrow(() => new DomainModelOverlayImpl(graph));
  assert.ok(overlay);
});

test("insertConcept — persists metadata + realizedBy + partOfContext + relatedTo edges", () => {
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  const node = overlay.insertConcept({
    conceptId: "c1",
    conceptKind: "entity",
    name: "User",
    clusterId: "users",
    confidenceScore: 0.85,
    evidenceProvenance: "mixed",
    contentHash: "ch1",
    realizedByElementIds: ["User"],
    partOfContextId: "ctx-users",
    relatedToConceptIds: ["c2"],
  });
  assert.equal(node.metadata.kind, DOMAIN_CONCEPT_METADATA_KIND);
  assert.equal(node.metadata.conceptKind, "entity");
  assert.equal(node.metadata.name, "User");

  assert.equal(overlay.realizedByEdges("c1").length, 1);
  const partOf = overlay.partOfContextEdge("c1");
  assert.ok(partOf);
  assert.equal(partOf.type, PART_OF_CONTEXT_EDGE_TYPE);
  assert.equal(overlay.relatedToEdges("c1").length, 1);
});

test("insertConcept — idempotent on identical content-hash", () => {
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  const a = overlay.insertConcept({
    conceptId: "c",
    conceptKind: "value-object",
    name: "Money",
    confidenceScore: 0.8,
    evidenceProvenance: "mixed",
    contentHash: "h",
    realizedByElementIds: ["Money"],
  });
  const b = overlay.insertConcept({
    conceptId: "c",
    conceptKind: "value-object",
    name: "Money",
    confidenceScore: 0.8,
    evidenceProvenance: "mixed",
    contentHash: "h",
    realizedByElementIds: ["Money"],
  });
  assert.equal(a.id, b.id);
  assert.equal(overlay.realizedByEdges("c").length, 1);
});

test("renameConcept — updates displayName, preserves identity", () => {
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  overlay.insertConcept({
    conceptId: "c",
    conceptKind: "entity",
    name: "User",
    confidenceScore: 0.85,
    evidenceProvenance: "mixed",
    contentHash: "h",
    realizedByElementIds: ["User"],
  });
  const renamed = overlay.renameConcept("c", "Customer");
  assert.equal(renamed.metadata.conceptId, "c");
  assert.equal(renamed.metadata.displayName, "Customer");
  assert.equal(renamed.metadata.name, "User");
});

test("renameConcept — PRESERVES realizedBy edges through supersede (Fathom 5.0.39)", () => {
  // Parallel to the clusters-overlay bug (5.0.39). `renameConcept`
  // calls `graph.supersedeNode` to write the new displayName, which
  // cascades the prior node's outgoing live edges to tombstoned —
  // including all `realizedBy` / `partOfContext` / `relatedTo` edges.
  // The current implementation does NOT re-emit those edges from the
  // new node, so renaming a concept silently strips its membership.
  //
  // Invariant: after any overlay-method-driven supersede of a concept
  // node, the same edge set must survive. The overlay owns the edge
  // invariant; its OWN methods MUST honor it.
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  overlay.insertConcept({
    conceptId: "concept-preserve",
    conceptKind: "entity",
    name: "User",
    confidenceScore: 0.85,
    evidenceProvenance: "mixed",
    contentHash: "h1",
    realizedByElementIds: ["User", "UserImpl", "UserRepo"],
  });
  assert.equal(overlay.realizedByEdges("concept-preserve").length, 3);
  overlay.renameConcept("concept-preserve", "Customer");
  assert.equal(
    overlay.realizedByEdges("concept-preserve").length,
    3,
    "renameConcept lost realizedBy edges — bug introduced by raw supersedeNode without edge reconciliation",
  );
});

test("setEnrichment — preserves realizedBy edges and writes llmEnrichment (Fathom 5.0.39)", () => {
  // The Haiku-concepts script (`run-haiku-concepts.ts`) writes
  // `llmEnrichment` onto concept metadata by calling
  // `graph.supersedeNode` directly — same bypass pattern as the
  // Haiku-clusters bug. Same fix: add `setEnrichment(conceptId, ...)`
  // to the overlay; the Haiku script switches over.
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  overlay.insertConcept({
    conceptId: "to-enrich",
    conceptKind: "bounded-context",
    name: "user-mgmt",
    confidenceScore: 0.9,
    evidenceProvenance: "mixed",
    contentHash: "h1",
    realizedByElementIds: ["User", "UserImpl", "UserRepo", "UserService"],
  });
  // Method does not yet exist — test fails with TypeError until 5.0.39.
  const o = overlay as unknown as {
    setEnrichment(
      conceptId: string,
      enrichment: { name: string; displayName?: string; summary?: string },
    ): unknown;
  };
  o.setEnrichment("to-enrich", {
    name: "user-management",
    displayName: "User Management",
    summary: "Identity + lifecycle.",
  });
  assert.equal(
    overlay.realizedByEdges("to-enrich").length,
    4,
    "setEnrichment lost realizedBy edges — same class of bug as renameConcept",
  );
  const node = overlay.listConcepts().find((c) => c.metadata.conceptId === "to-enrich");
  const enriched = (node?.metadata as { llmEnrichment?: { name?: string; displayName?: string } }).llmEnrichment;
  assert.equal(enriched?.name, "user-management");
  assert.equal(enriched?.displayName, "User Management");
});

test("insertConcept — persists distinctiveness + dominanceSupport observable-support fields (3.3.12)", () => {
  // Fathom row 3.3.12 (overlay-confidence-honest-null-policy): the
  // bounded-context / aggregate-root confidence-saturation fix
  // persists `distinctiveness` / `dominanceSupport` as observable
  // support signals alongside the (still-clamped) confidenceScore —
  // without them, two concepts saturating at the same confidenceScore
  // are indistinguishable once persisted.
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  const bc = overlay.insertConcept({
    conceptId: "bc-1",
    conceptKind: "bounded-context",
    name: "orders",
    confidenceScore: 0.9,
    evidenceProvenance: "mixed",
    contentHash: "h-bc",
    realizedByElementIds: ["OrderService"],
    distinctiveness: 0.6,
  });
  assert.equal(bc.metadata.distinctiveness, 0.6);

  const ar = overlay.insertConcept({
    conceptId: "ar-1",
    conceptKind: "aggregate-root",
    name: "Order",
    confidenceScore: 0.9,
    evidenceProvenance: "mixed",
    contentHash: "h-ar",
    realizedByElementIds: ["Order"],
    dominanceSupport: 1,
  });
  assert.equal(ar.metadata.dominanceSupport, 1);
});

test("renameConcept — throws on unknown conceptId", () => {
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  assert.throws(() => overlay.renameConcept("nope", "X"));
});

test("tombstoneConcept — removes from listConcepts", () => {
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  overlay.insertConcept({
    conceptId: "doomed",
    conceptKind: "entity",
    name: "Doomed",
    confidenceScore: 0.85,
    evidenceProvenance: "mixed",
    contentHash: "h",
    realizedByElementIds: ["Doomed"],
  });
  assert.equal(overlay.listConcepts().length, 1);
  overlay.tombstoneConcept("doomed");
  assert.equal(overlay.listConcepts().length, 0);
});

test("conceptsByKind — filters by conceptKind", () => {
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  overlay.insertConcept({
    conceptId: "e1",
    conceptKind: "entity",
    name: "User",
    confidenceScore: 0.85,
    evidenceProvenance: "mixed",
    contentHash: "h1",
    realizedByElementIds: ["User"],
  });
  overlay.insertConcept({
    conceptId: "v1",
    conceptKind: "value-object",
    name: "Money",
    confidenceScore: 0.85,
    evidenceProvenance: "mixed",
    contentHash: "h2",
    realizedByElementIds: ["Money"],
  });
  assert.equal(overlay.conceptsByKind("entity").length, 1);
  assert.equal(overlay.conceptsByKind("value-object").length, 1);
  assert.equal(overlay.conceptsByKind("aggregate-root").length, 0);
});

test("conceptsInCluster — filters by clusterId", () => {
  const graph = makeGraph();
  const overlay = makeDomainModelOverlay(graph);
  overlay.insertConcept({
    conceptId: "e1",
    conceptKind: "entity",
    name: "User",
    clusterId: "users",
    confidenceScore: 0.85,
    evidenceProvenance: "mixed",
    contentHash: "h1",
    realizedByElementIds: ["User"],
  });
  overlay.insertConcept({
    conceptId: "e2",
    conceptKind: "entity",
    name: "Payment",
    clusterId: "payments",
    confidenceScore: 0.85,
    evidenceProvenance: "mixed",
    contentHash: "h2",
    realizedByElementIds: ["Payment"],
  });
  assert.equal(overlay.conceptsInCluster("users").length, 1);
  assert.equal(overlay.conceptsInCluster("payments").length, 1);
  assert.equal(overlay.conceptsInCluster("orders").length, 0);
});

test("DOMAIN_CONCEPT_DOMAIN — domain identifier", () => {
  assert.equal(DOMAIN_CONCEPT_DOMAIN, "domain-concept");
});
