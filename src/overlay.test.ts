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
    contentHash: "h",
    realizedByElementIds: ["Money"],
  });
  const b = overlay.insertConcept({
    conceptId: "c",
    conceptKind: "value-object",
    name: "Money",
    confidenceScore: 0.8,
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
    contentHash: "h",
    realizedByElementIds: ["User"],
  });
  const renamed = overlay.renameConcept("c", "Customer");
  assert.equal(renamed.metadata.conceptId, "c");
  assert.equal(renamed.metadata.displayName, "Customer");
  assert.equal(renamed.metadata.name, "User");
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
    contentHash: "h1",
    realizedByElementIds: ["User"],
  });
  overlay.insertConcept({
    conceptId: "v1",
    conceptKind: "value-object",
    name: "Money",
    confidenceScore: 0.85,
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
    contentHash: "h1",
    realizedByElementIds: ["User"],
  });
  overlay.insertConcept({
    conceptId: "e2",
    conceptKind: "entity",
    name: "Payment",
    clusterId: "payments",
    confidenceScore: 0.85,
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
