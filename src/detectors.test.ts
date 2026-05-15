/**
 * Per-kind detector tests. Each concept gets a positive (matcher fires)
 * + negative (matcher doesn't fire) fixture per testing-standards Rule 6.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import type {
  DomainClusterInfo,
  DomainContext,
  DomainEdge,
  DomainElement,
} from "./context.js";
import {
  detectAggregateRoots,
  detectBoundedContexts,
  detectDomainServices,
  detectEntities,
  detectValueObjects,
} from "./detectors.js";

interface Build {
  elements?: DomainElement[];
  classStereotypes?: ReadonlyMap<string, string>;
  methodStereotypes?: ReadonlyMap<string, string>;
  childrenOf?: ReadonlyMap<string, readonly string[]>;
  parentOf?: ReadonlyMap<string, string>;
  referencesEdges?: DomainEdge[];
  inheritsEdges?: ReadonlyMap<string, readonly string[]>;
  clusters?: DomainClusterInfo[];
  clusterByElement?: ReadonlyMap<string, string>;
  layerByCluster?: ReadonlyMap<string, number>;
}

function buildContext(b: Build = {}): DomainContext {
  return {
    elements: b.elements ?? [],
    classStereotypes: b.classStereotypes ?? new Map(),
    methodStereotypes: b.methodStereotypes ?? new Map(),
    childrenOf: b.childrenOf ?? new Map(),
    parentOf: b.parentOf ?? new Map(),
    referencesEdges: b.referencesEdges ?? [],
    inheritsEdges: b.inheritsEdges ?? new Map(),
    clusters: b.clusters ?? [],
    clusterByElement: b.clusterByElement ?? new Map(),
    layerByCluster: b.layerByCluster ?? new Map(),
  };
}

// --- detectEntities -------------------------------------------------------

test("detectEntities — fires on class with classStereotype 'entity'", () => {
  const ctx = buildContext({
    elements: [
      { id: "User", name: "User", kind: "class" },
      { id: "User.name", name: "name", kind: "field" },
      { id: "User.email", name: "email", kind: "field" },
    ],
    classStereotypes: new Map([["User", "entity"]]),
    childrenOf: new Map([["User", ["User.name", "User.email"]]]),
  });
  const out = detectEntities(ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "User");
  assert.equal(out[0].conceptKind, "entity");
});

test("detectEntities — doesn't fire on non-entity stereotype", () => {
  const ctx = buildContext({
    elements: [{ id: "Foo", name: "Foo", kind: "class" }],
    classStereotypes: new Map([["Foo", "controller"]]),
  });
  assert.equal(detectEntities(ctx).length, 0);
});

// --- detectValueObjects ---------------------------------------------------

test("detectValueObjects — fires on data-class with no mutator-shaped methods", () => {
  const ctx = buildContext({
    elements: [
      { id: "Money", name: "Money", kind: "class" },
      { id: "Money.amount", name: "amount", kind: "field" },
      { id: "Money.getAmount", name: "getAmount", kind: "method" },
    ],
    classStereotypes: new Map([["Money", "data-class"]]),
    methodStereotypes: new Map([["Money.getAmount", "accessor-shaped"]]),
    childrenOf: new Map([["Money", ["Money.amount", "Money.getAmount"]]]),
  });
  const out = detectValueObjects(ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].conceptKind, "value-object");
});

test("detectValueObjects — doesn't fire when data-class has a mutator method", () => {
  const ctx = buildContext({
    elements: [
      { id: "M", name: "M", kind: "class" },
      { id: "M.setValue", name: "setValue", kind: "method" },
    ],
    classStereotypes: new Map([["M", "data-class"]]),
    methodStereotypes: new Map([["M.setValue", "mutator-shaped"]]),
    childrenOf: new Map([["M", ["M.setValue"]]]),
  });
  assert.equal(detectValueObjects(ctx).length, 0);
});

// --- detectAggregateRoots -------------------------------------------------

test("detectAggregateRoots — fires on entity with the most inbound refs in cluster", () => {
  // Order, OrderLine, OrderItem all entities in cluster c1.
  // OrderLine → Order, OrderItem → Order. Order is the root (2 inbound).
  const ctx = buildContext({
    elements: [
      { id: "Order", name: "Order", kind: "class" },
      { id: "OrderLine", name: "OrderLine", kind: "class" },
      { id: "OrderItem", name: "OrderItem", kind: "class" },
    ],
    classStereotypes: new Map([
      ["Order", "entity"],
      ["OrderLine", "entity"],
      ["OrderItem", "entity"],
    ]),
    referencesEdges: [
      { source: "OrderLine", target: "Order" },
      { source: "OrderItem", target: "Order" },
    ],
    clusterByElement: new Map([
      ["Order", "c1"],
      ["OrderLine", "c1"],
      ["OrderItem", "c1"],
    ]),
  });
  const entities = detectEntities(ctx);
  const out = detectAggregateRoots(ctx, entities);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Order");
});

test("detectAggregateRoots — doesn't fire when cluster has only one entity", () => {
  const ctx = buildContext({
    elements: [{ id: "Solo", name: "Solo", kind: "class" }],
    classStereotypes: new Map([["Solo", "entity"]]),
    clusterByElement: new Map([["Solo", "c1"]]),
  });
  const entities = detectEntities(ctx);
  assert.equal(detectAggregateRoots(ctx, entities).length, 0);
});

// --- detectDomainServices -------------------------------------------------

test("detectDomainServices — fires on controller-stereotype class with no fields", () => {
  const ctx = buildContext({
    elements: [
      { id: "Coord", name: "OrderCoordinator", kind: "class" },
      { id: "Coord.handle", name: "handle", kind: "method" },
    ],
    classStereotypes: new Map([["Coord", "controller"]]),
    childrenOf: new Map([["Coord", ["Coord.handle"]]]),
    clusters: [{ clusterId: "c1", name: "orders", memberCount: 1 }],
    clusterByElement: new Map([["Coord", "c1"]]),
  });
  const out = detectDomainServices(ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].conceptKind, "domain-service");
});

test("detectDomainServices — skips adapter-flavored cluster", () => {
  const ctx = buildContext({
    elements: [
      { id: "Svc", name: "EmailService", kind: "class" },
      { id: "Svc.send", name: "send", kind: "method" },
    ],
    classStereotypes: new Map([["Svc", "controller"]]),
    childrenOf: new Map([["Svc", ["Svc.send"]]]),
    clusters: [{ clusterId: "c1", name: "email-adapter", memberCount: 1 }],
    clusterByElement: new Map([["Svc", "c1"]]),
  });
  assert.equal(detectDomainServices(ctx).length, 0);
});

// --- detectBoundedContexts ------------------------------------------------

test("detectBoundedContexts — fires on cluster with ≥3 members + distinct vocabulary", () => {
  const ctx = buildContext({
    elements: [
      { id: "e1", name: "OrderService", kind: "class" },
      { id: "e2", name: "OrderRepository", kind: "class" },
      { id: "e3", name: "OrderItem", kind: "class" },
      // A second cluster with different vocabulary.
      { id: "e4", name: "PaymentGateway", kind: "class" },
      { id: "e5", name: "PaymentProvider", kind: "class" },
      { id: "e6", name: "PaymentResult", kind: "class" },
    ],
    clusters: [
      { clusterId: "orders", name: "orders", memberCount: 3 },
      { clusterId: "payments", name: "payments", memberCount: 3 },
    ],
    clusterByElement: new Map([
      ["e1", "orders"],
      ["e2", "orders"],
      ["e3", "orders"],
      ["e4", "payments"],
      ["e5", "payments"],
      ["e6", "payments"],
    ]),
  });
  const out = detectBoundedContexts(ctx);
  assert.ok(out.length >= 1);
  const orders = out.find((c) => c.clusterId === "orders");
  assert.ok(orders);
  assert.equal(orders.conceptKind, "bounded-context");
});

test("detectBoundedContexts — doesn't fire on cluster below minClusterSize", () => {
  const ctx = buildContext({
    elements: [
      { id: "e1", name: "Tiny", kind: "class" },
      { id: "e2", name: "Small", kind: "class" },
    ],
    clusters: [{ clusterId: "c1", name: "c1", memberCount: 2 }],
    clusterByElement: new Map([
      ["e1", "c1"],
      ["e2", "c1"],
    ]),
  });
  assert.equal(detectBoundedContexts(ctx, { minClusterSize: 3 }).length, 0);
});
