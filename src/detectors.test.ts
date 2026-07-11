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

test("detectValueObjects — fires on TS interface with ≥ 2 fields and no methods (Fathom 5.0.17)", () => {
  // TS expresses many value objects as `interface` (pure shape, no
  // methods). The `data-class` stereotype is impossible for interfaces
  // because stereotypes.ts short-circuits to `interface` first; without
  // the interface-shape path, TS value objects are invisible to L7b.
  const ctx = buildContext({
    elements: [
      { id: "Money", name: "Money", kind: "interface" },
      { id: "Money.amount", name: "amount", kind: "field" },
      { id: "Money.currency", name: "currency", kind: "field" },
    ],
    childrenOf: new Map([["Money", ["Money.amount", "Money.currency"]]]),
  });
  const out = detectValueObjects(ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].conceptKind, "value-object");
  assert.equal(out[0].name, "Money");
});

test("detectValueObjects — doesn't fire on TS interface with fewer than 2 fields", () => {
  const ctx = buildContext({
    elements: [
      { id: "X", name: "X", kind: "interface" },
      { id: "X.a", name: "a", kind: "field" },
    ],
    childrenOf: new Map([["X", ["X.a"]]]),
  });
  assert.equal(detectValueObjects(ctx).length, 0);
});

test("detectValueObjects — doesn't fire on TS interface with method children", () => {
  const ctx = buildContext({
    elements: [
      { id: "Repo", name: "Repo", kind: "interface" },
      { id: "Repo.id", name: "id", kind: "field" },
      { id: "Repo.name", name: "name", kind: "field" },
      { id: "Repo.save", name: "save", kind: "method" },
    ],
    childrenOf: new Map([["Repo", ["Repo.id", "Repo.name", "Repo.save"]]]),
  });
  assert.equal(detectValueObjects(ctx).length, 0);
});

test("detectValueObjects — rejects option-bag suffixes (Fathom 5.0.26 a)", () => {
  // Round-5 F8: 30+ option-bags classified as VO. Names ending in
  // Options / Input / Metadata / Result etc. are configuration shapes,
  // not DDD value objects.
  const ctx = buildContext({
    elements: [
      { id: "ComposeOptions", name: "ComposeOptions", kind: "interface" },
      { id: "ComposeOptions.graph", name: "graph", kind: "field" },
      { id: "ComposeOptions.config", name: "config", kind: "field" },
      { id: "AnalyzeResult", name: "AnalyzeResult", kind: "interface" },
      { id: "AnalyzeResult.queries", name: "queries", kind: "field" },
      { id: "AnalyzeResult.graph", name: "graph", kind: "field" },
    ],
    childrenOf: new Map([
      ["ComposeOptions", ["ComposeOptions.graph", "ComposeOptions.config"]],
      ["AnalyzeResult", ["AnalyzeResult.queries", "AnalyzeResult.graph"]],
    ]),
  });
  // Neither should fire — both are option-bag-named.
  assert.equal(detectValueObjects(ctx).length, 0);
});

test("detectValueObjects — rejects fixture-pathed elements (Fathom 5.0.26 b)", () => {
  // Round-5 F9 saw `halsteadhelpers` (a test helper) classified as
  // entity; same family of false-positives would hit VO. Path-based
  // exclusion matches /tests/, /fixtures/, etc.
  const ctx = buildContext({
    elements: [
      { id: ":Users:dev:proj:src:tests:money.ts#Money", name: "Money", kind: "interface" },
      { id: ":Users:dev:proj:src:tests:money.ts#Money.amount", name: "amount", kind: "field" },
      { id: ":Users:dev:proj:src:tests:money.ts#Money.currency", name: "currency", kind: "field" },
    ],
    childrenOf: new Map([
      [":Users:dev:proj:src:tests:money.ts#Money",
        [":Users:dev:proj:src:tests:money.ts#Money.amount",
         ":Users:dev:proj:src:tests:money.ts#Money.currency"]],
    ]),
  });
  assert.equal(detectValueObjects(ctx).length, 0);
});

test("detectEntities — fires on TS interface with ≥3 fields + implementor (Fathom 5.0.26 c)", () => {
  // TS expresses many entity shapes as interfaces with implementations.
  // An interface with substantive shape AND ≥1 implementor counts as
  // entity-shape (distinct from value-object's pure shape).
  const ctx = buildContext({
    elements: [
      { id: "User", name: "User", kind: "interface" },
      { id: "User.id", name: "id", kind: "field" },
      { id: "User.name", name: "name", kind: "field" },
      { id: "User.email", name: "email", kind: "field" },
      { id: "UserImpl", name: "UserImpl", kind: "class" },
    ],
    childrenOf: new Map([["User", ["User.id", "User.name", "User.email"]]]),
    inheritsEdges: new Map([["UserImpl", ["User"]]]),
  });
  const entities = detectEntities(ctx);
  const user = entities.find((e) => e.name === "User");
  assert.ok(user !== undefined, "User interface with 3 fields + implementor should be entity");
});

test("detectEntities — fires on 'large-class' stereotype with entity shape (Fathom 5.0.36)", () => {
  // Round-6 pilot F12: graphlayerimpl (~936 LOC, 12 fields, dozens of
  // methods, mutable state + behavior) is structurally an entity but
  // classifies as `large-class` (anti-pattern stereotype, rule 2 in the
  // stereotype rule cascade fires before rule 5 entity). With the
  // strict `stereo !== "entity"` gate, detectEntities silently skips
  // the canonical entity case — the workspace's largest, most
  // stateful, most-mutated class.
  //
  // Fix: detectEntities accepts `large-class` when entity-shape holds
  // (≥3 fields AND ≥3 method children). Large-classes ARE entities,
  // just oversized — surfacing them as entity does not contradict
  // their anti-pattern classification (detection layer + L6 patterns
  // continue to flag them as god-class for ratings + violations).
  const ctx = buildContext({
    elements: [
      { id: "BigEntity", name: "BigEntity", kind: "class" },
      { id: "BigEntity.id", name: "id", kind: "field" },
      { id: "BigEntity.state", name: "state", kind: "field" },
      { id: "BigEntity.history", name: "history", kind: "field" },
      { id: "BigEntity.update", name: "update", kind: "method" },
      { id: "BigEntity.tombstone", name: "tombstone", kind: "method" },
      { id: "BigEntity.recordEvent", name: "recordEvent", kind: "method" },
    ],
    classStereotypes: new Map([["BigEntity", "large-class"]]),
    childrenOf: new Map([
      [
        "BigEntity",
        [
          "BigEntity.id",
          "BigEntity.state",
          "BigEntity.history",
          "BigEntity.update",
          "BigEntity.tombstone",
          "BigEntity.recordEvent",
        ],
      ],
    ]),
  });
  const entities = detectEntities(ctx);
  const big = entities.find((e) => e.name === "BigEntity");
  assert.ok(big !== undefined, "large-class with entity-shape should fire as entity");
  assert.equal(big.conceptKind, "entity");
});

test("detectEntities — does NOT fire on 'large-class' lacking entity shape (Fathom 5.0.36)", () => {
  // A large-class with too few fields (< 3) doesn't have entity shape —
  // it's an oversized procedural module, not a domain entity. Stays
  // unclassified at L7b. Same threshold as the existing entity rule.
  const ctx = buildContext({
    elements: [
      { id: "Procedural", name: "Procedural", kind: "class" },
      { id: "Procedural.config", name: "config", kind: "field" },
      { id: "Procedural.doA", name: "doA", kind: "method" },
      { id: "Procedural.doB", name: "doB", kind: "method" },
      { id: "Procedural.doC", name: "doC", kind: "method" },
      { id: "Procedural.doD", name: "doD", kind: "method" },
    ],
    classStereotypes: new Map([["Procedural", "large-class"]]),
    childrenOf: new Map([
      [
        "Procedural",
        [
          "Procedural.config",
          "Procedural.doA",
          "Procedural.doB",
          "Procedural.doC",
          "Procedural.doD",
        ],
      ],
    ]),
  });
  assert.equal(
    detectEntities(ctx).find((e) => e.name === "Procedural"),
    undefined,
  );
});

test("detectEntities — does NOT fire on shape-only interface without implementor", () => {
  // Pure data shape — should go to value-object, not entity.
  const ctx = buildContext({
    elements: [
      { id: "Point", name: "Point", kind: "interface" },
      { id: "Point.x", name: "x", kind: "field" },
      { id: "Point.y", name: "y", kind: "field" },
      { id: "Point.z", name: "z", kind: "field" },
    ],
    childrenOf: new Map([["Point", ["Point.x", "Point.y", "Point.z"]]]),
  });
  const entities = detectEntities(ctx);
  assert.equal(entities.find((e) => e.name === "Point"), undefined);
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
  // 3.3.12 (overlay-confidence-honest-null-policy): dominance is
  // support-unweighted — 2 total same-cluster inbound refs back this
  // dominance=1.0 read. dominanceSupport makes that evidence count
  // observable instead of silently absorbing it into the 0.9 cap.
  assert.equal(out[0].dominanceSupport, 2);
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

// Fathom row 3.3.12 (overlay-confidence-honest-null-policy) — the
// aggregate-root confidence site. `dominance = best.count / totalRefs`
// is support-unweighted: a `totalRefs === 1` cluster (a single
// same-cluster entity-to-entity reference, anywhere) forces
// dominance === 1.0 exactly like a cluster backed by dozens of
// references — the pre-fix 0.9-capped score was silently identical in
// both cases. `dominanceSupport` (= totalRefs) makes the evidence
// count observable so a 0.9-from-1-edge read is distinguishable from
// a 0.9-from-many read, without changing the numeric confidenceScore
// (support-aware persisted field, not a score reweight — see
// CHANGELOG for the rationale).
test("detectAggregateRoots — single-edge dominance is flagged low-support via dominanceSupport (3.3.12)", () => {
  // A single same-cluster entity-to-entity reference anywhere in the
  // cluster: B → A. totalRefs = 1, best.count = 1, dominance = 1.0 —
  // forced exactly like the many-edge case below, but on one data point.
  const ctx = buildContext({
    elements: [
      { id: "A", name: "A", kind: "class" },
      { id: "B", name: "B", kind: "class" },
    ],
    classStereotypes: new Map([
      ["A", "entity"],
      ["B", "entity"],
    ]),
    referencesEdges: [{ source: "B", target: "A" }],
    clusterByElement: new Map([
      ["A", "c1"],
      ["B", "c1"],
    ]),
  });
  const entities = detectEntities(ctx);
  const out = detectAggregateRoots(ctx, entities);
  assert.equal(out.length, 1);
  // 0.6 + 1.0*0.3 lands on the well-known IEEE754 double artifact
  // (0.8999999999999999, not 0.9) — pre-existing to this fix and out
  // of the confidence-scoring-policy scope; tolerant comparison.
  assert.ok(Math.abs(out[0].confidenceScore - 0.9) < 1e-9);
  assert.equal(out[0].dominanceSupport, 1);
});

test("detectAggregateRoots — dominanceSupport distinguishes 0.9-from-one-edge from 0.9-from-many (3.3.12)", () => {
  // Root gets 5 inbound same-cluster references from 5 distinct
  // entities. dominance is still exactly 1.0 (best.count === totalRefs,
  // same as the single-edge fixture above) and confidenceScore is
  // identically capped at 0.9 — but dominanceSupport (5 vs 1) is the
  // observable signal a consumer needs to rank this read as
  // higher-evidence than the single-edge case.
  const ctx = buildContext({
    elements: [
      { id: "Root", name: "Root", kind: "class" },
      { id: "R1", name: "R1", kind: "class" },
      { id: "R2", name: "R2", kind: "class" },
      { id: "R3", name: "R3", kind: "class" },
      { id: "R4", name: "R4", kind: "class" },
      { id: "R5", name: "R5", kind: "class" },
    ],
    classStereotypes: new Map([
      ["Root", "entity"],
      ["R1", "entity"],
      ["R2", "entity"],
      ["R3", "entity"],
      ["R4", "entity"],
      ["R5", "entity"],
    ]),
    referencesEdges: [
      { source: "R1", target: "Root" },
      { source: "R2", target: "Root" },
      { source: "R3", target: "Root" },
      { source: "R4", target: "Root" },
      { source: "R5", target: "Root" },
    ],
    clusterByElement: new Map([
      ["Root", "c1"],
      ["R1", "c1"],
      ["R2", "c1"],
      ["R3", "c1"],
      ["R4", "c1"],
      ["R5", "c1"],
    ]),
  });
  const entities = detectEntities(ctx);
  const out = detectAggregateRoots(ctx, entities);
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0].confidenceScore - 0.9) < 1e-9);
  assert.equal(out[0].dominanceSupport, 5);
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
      { id: "e7", name: "OrderCheckout", kind: "class" },
      { id: "e8", name: "OrderConfirmation", kind: "class" },
      // A second cluster with different vocabulary.
      { id: "e4", name: "PaymentGateway", kind: "class" },
      { id: "e5", name: "PaymentProvider", kind: "class" },
      { id: "e6", name: "PaymentResult", kind: "class" },
      { id: "e9", name: "PaymentReceipt", kind: "class" },
      { id: "e10", name: "PaymentAuthorization", kind: "class" },
    ],
    clusters: [
      { clusterId: "orders", name: "orders", memberCount: 5 },
      { clusterId: "payments", name: "payments", memberCount: 5 },
    ],
    clusterByElement: new Map([
      ["e1", "orders"],
      ["e2", "orders"],
      ["e3", "orders"],
      ["e7", "orders"],
      ["e8", "orders"],
      ["e4", "payments"],
      ["e5", "payments"],
      ["e6", "payments"],
      ["e9", "payments"],
      ["e10", "payments"],
    ]),
  });
  const out = detectBoundedContexts(ctx);
  assert.ok(out.length >= 1);
  const orders = out.find((c) => c.clusterId === "orders");
  assert.ok(orders);
  assert.equal(orders.conceptKind, "bounded-context");
  // Fathom row 3.3.12 (overlay-confidence-honest-null-policy): pre-fix
  // this cluster (distinctiveness=1.0, ≥5 members) landed at a forced
  // confidenceScore of exactly 1.0 via the dead `layerOk` +0.1 — 35/39
  // live bounded-contexts measured at that mass point. Post-fix the
  // ceiling is 0.9 (layerOk deleted, no real signal ever backed it),
  // and the raw `distinctiveness` that drives the saturation is
  // persisted as an observable support field.
  assert.equal(orders.confidenceScore, 0.9);
  assert.equal(orders.distinctiveness, 1);
});

// Fathom row 3.3.12 (overlay-confidence-honest-null-policy) — the
// bounded-context confidence site. `Math.min(1, 0.5 + min(0.3,
// distinctiveness*0.5) + 0.1[layerOk, dead] + 0.1[size])` forces ANY
// cluster with distinctiveness ≥ 0.6 and ≥ 5 members to the exact same
// confidenceScore, whether distinctiveness is 0.6 (barely cleared) or
// 1.0 (maximally distinctive) — a forced mass point at the ceiling.
// `distinctiveness` is now persisted alongside confidenceScore so two
// clusters that saturate identically are still distinguishable by
// their real evidence.
test("detectBoundedContexts — distinctiveness support field distinguishes two clusters saturating at the same confidenceScore (3.3.12)", () => {
  const ctx = buildContext({
    elements: [
      // clusterA: 5 distinct terms, 2 of which (shareone/sharetwo) also
      // appear in clusterFiller — distinctiveness = 3/5 = 0.6, exactly
      // at the saturation threshold.
      { id: "a1", name: "Alpha", kind: "class" },
      { id: "a2", name: "Beta", kind: "class" },
      { id: "a3", name: "Gamma", kind: "class" },
      { id: "a4", name: "Shareone", kind: "class" },
      { id: "a5", name: "Sharetwo", kind: "class" },
      // clusterB: fully distinct vocabulary — distinctiveness = 1.0.
      { id: "b1", name: "OrderService", kind: "class" },
      { id: "b2", name: "OrderRepository", kind: "class" },
      { id: "b3", name: "OrderItem", kind: "class" },
      { id: "b4", name: "OrderCheckout", kind: "class" },
      { id: "b5", name: "OrderConfirmation", kind: "class" },
      // clusterFiller: not a bounded-context candidate (omitted from
      // ctx.clusters below) — exists only to raise shareone/sharetwo's
      // document frequency to 2, pulling clusterA's distinctiveness
      // down to exactly 0.6.
      { id: "f1", name: "Shareone", kind: "class" },
      { id: "f2", name: "Sharetwo", kind: "class" },
    ],
    clusters: [
      { clusterId: "clusterA", name: "clusterA", memberCount: 5 },
      { clusterId: "clusterB", name: "clusterB", memberCount: 5 },
    ],
    clusterByElement: new Map([
      ["a1", "clusterA"],
      ["a2", "clusterA"],
      ["a3", "clusterA"],
      ["a4", "clusterA"],
      ["a5", "clusterA"],
      ["b1", "clusterB"],
      ["b2", "clusterB"],
      ["b3", "clusterB"],
      ["b4", "clusterB"],
      ["b5", "clusterB"],
      ["f1", "clusterFiller"],
      ["f2", "clusterFiller"],
    ]),
  });
  const out = detectBoundedContexts(ctx);
  const clusterA = out.find((c) => c.clusterId === "clusterA");
  const clusterB = out.find((c) => c.clusterId === "clusterB");
  assert.ok(clusterA);
  assert.ok(clusterB);
  // Same clamped score...
  assert.equal(clusterA.confidenceScore, 0.9);
  assert.equal(clusterB.confidenceScore, 0.9);
  // ...but distinguishable real evidence.
  assert.equal(clusterA.distinctiveness, 0.6);
  assert.equal(clusterB.distinctiveness, 1);
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

// Fathom row 3.2.4 regression suite — tightened thresholds 2026-05-15
// after the Phase 3 smoke flagged 313/578 clusters as bounded contexts
// on the Fathom workspace. Defaults now: distinctiveness ≥ 0.4, ≥ 5
// distinct vocabulary terms (was: 0.2 / no vocab floor).

test("detectBoundedContexts — doesn't fire when vocabulary below minVocabularySize (3.2.4 regression)", () => {
  // 3-member cluster with only 3 distinct terms — below the 5-term
  // floor. Under the old code (no vocab floor + 0.2 distinctiveness
  // threshold), this would have fired because all 3 terms are unique
  // to the cluster (distinctiveness = 1.0).
  const ctx = buildContext({
    elements: [
      { id: "e1", name: "Foo", kind: "class" },
      { id: "e2", name: "Bar", kind: "class" },
      { id: "e3", name: "Baz", kind: "class" },
    ],
    clusters: [{ clusterId: "tiny", name: "tiny", memberCount: 3 }],
    clusterByElement: new Map([
      ["e1", "tiny"],
      ["e2", "tiny"],
      ["e3", "tiny"],
    ]),
  });
  // Only 3 distinct terms (foo, bar, baz) — below the 5-term floor.
  assert.equal(detectBoundedContexts(ctx).length, 0);
});

test("detectBoundedContexts — doesn't fire when distinctiveness below 0.4 (3.2.4 regression)", () => {
  // Two clusters that share most of their vocabulary — distinctiveness
  // is 0 for both (every term appears in both clusters). Under the old
  // 0.2 threshold this would have fired in some borderline cases;
  // raising to 0.4 plus the 5-term floor cleans up these noisy
  // detections systematically.
  const ctx = buildContext({
    elements: [
      { id: "e1", name: "DataReaderHelper", kind: "class" },
      { id: "e2", name: "DataWriterHelper", kind: "class" },
      { id: "e3", name: "DataValidatorHelper", kind: "class" },
      { id: "e4", name: "DataReaderUtil", kind: "class" },
      { id: "e5", name: "DataWriterUtil", kind: "class" },
      { id: "e6", name: "DataValidatorUtil", kind: "class" },
    ],
    clusters: [
      { clusterId: "helpers", name: "helpers", memberCount: 3 },
      { clusterId: "utils", name: "utils", memberCount: 3 },
    ],
    clusterByElement: new Map([
      ["e1", "helpers"],
      ["e2", "helpers"],
      ["e3", "helpers"],
      ["e4", "utils"],
      ["e5", "utils"],
      ["e6", "utils"],
    ]),
  });
  // helpers vocab: data, reader, writer, validator, helper — 5 terms
  // utils vocab:   data, reader, writer, validator, util    — 5 terms
  // distinctiveness for both ≈ 1/5 = 0.2 (only the suffix is unique).
  // Below the 0.4 floor → neither fires.
  assert.equal(detectBoundedContexts(ctx).length, 0);
});

test("detectBoundedContexts — options can loosen thresholds for permissive callers (3.2.4)", () => {
  // Same fixture as the negative vocab-floor case above. Passing
  // looser options recovers the v1 behavior for callers that want
  // permissive detection.
  const ctx = buildContext({
    elements: [
      { id: "e1", name: "Foo", kind: "class" },
      { id: "e2", name: "Bar", kind: "class" },
      { id: "e3", name: "Baz", kind: "class" },
    ],
    clusters: [{ clusterId: "tiny", name: "tiny", memberCount: 3 }],
    clusterByElement: new Map([
      ["e1", "tiny"],
      ["e2", "tiny"],
      ["e3", "tiny"],
    ]),
  });
  // With loosened options, the 3-term tiny cluster fires again.
  const out = detectBoundedContexts(ctx, {
    minVocabularySize: 2,
    minDistinctiveness: 0.1,
  });
  assert.equal(out.length, 1);
});

// --- helper-module skips (Fathom 5.0.43 / round-8 F6) ---------------------

test("detectEntities — rejects helper-module name suffix (Fathom 5.0.43 / round-8 F6)", () => {
  // Round-8 F6: dotnet partial-class helpers `cognitivehelpers`,
  // `halsteadhelpers`, `analysishelpers` etc. surface as entities
  // when L1 stereotype lands on entity-like or large-class shape.
  // Same exclusion shape as fixture-path (5.0.26 b) but name-suffix
  // based instead of path based.
  const ctx = buildContext({
    elements: [
      { id: "CognitiveHelpers", name: "CognitiveHelpers", kind: "class" },
      { id: "CognitiveHelpers.f1", name: "f1", kind: "field" },
      { id: "CognitiveHelpers.f2", name: "f2", kind: "field" },
      { id: "CognitiveHelpers.f3", name: "f3", kind: "field" },
      { id: "CognitiveHelpers.m1", name: "m1", kind: "method" },
      { id: "CognitiveHelpers.m2", name: "m2", kind: "method" },
      { id: "CognitiveHelpers.m3", name: "m3", kind: "method" },
    ],
    classStereotypes: new Map([["CognitiveHelpers", "entity"]]),
    childrenOf: new Map([
      ["CognitiveHelpers", [
        "CognitiveHelpers.f1", "CognitiveHelpers.f2", "CognitiveHelpers.f3",
        "CognitiveHelpers.m1", "CognitiveHelpers.m2", "CognitiveHelpers.m3",
      ]],
    ]),
  });
  assert.equal(detectEntities(ctx).length, 0);
});

test("detectValueObjects — rejects helper-module name suffix (Fathom 5.0.43 / round-8 F6)", () => {
  const ctx = buildContext({
    elements: [
      { id: "StringHelpers", name: "StringHelpers", kind: "interface" },
      { id: "StringHelpers.f1", name: "f1", kind: "field" },
      { id: "StringHelpers.f2", name: "f2", kind: "field" },
    ],
    childrenOf: new Map([
      ["StringHelpers", ["StringHelpers.f1", "StringHelpers.f2"]],
    ]),
  });
  assert.equal(detectValueObjects(ctx).length, 0);
});

test("detectDomainServices — rejects helper-module name suffix (Fathom 5.0.43 / round-8 F6)", () => {
  const ctx = buildContext({
    elements: [
      { id: "AnalysisHelpers", name: "AnalysisHelpers", kind: "class" },
      { id: "AnalysisHelpers.m1", name: "m1", kind: "method" },
    ],
    classStereotypes: new Map([["AnalysisHelpers", "controller"]]),
    childrenOf: new Map([["AnalysisHelpers", ["AnalysisHelpers.m1"]]]),
  });
  assert.equal(detectDomainServices(ctx).length, 0);
});

test("detectBoundedContexts — rejects cluster whose class-kind members are all helper-modules (Fathom 5.0.43 / round-8 F6)", () => {
  // Round-8 F6: `cluster-halsteadhelpers`, `cluster-cognitivehelpers/state`
  // etc. surface as bounded-contexts even though their realizedBy is
  // dominated by helper-module partial classes. Skip when ALL class-kind
  // realizedBy elements are helper-suffixed.
  const ctx = buildContext({
    elements: [
      { id: "h1", name: "CognitiveHelpers", kind: "class" },
      { id: "h2", name: "HalsteadHelpers", kind: "class" },
      { id: "h3", name: "AnalysisHelpers", kind: "class" },
      { id: "h4", name: "ScalarHelpers", kind: "class" },
      { id: "h5", name: "IntraclassHelpers", kind: "class" },
    ],
    clusters: [{ clusterId: "dotnet-helpers", name: "cluster-dotnethelpers", memberCount: 5 }],
    clusterByElement: new Map([
      ["h1", "dotnet-helpers"], ["h2", "dotnet-helpers"], ["h3", "dotnet-helpers"],
      ["h4", "dotnet-helpers"], ["h5", "dotnet-helpers"],
    ]),
  });
  assert.equal(detectBoundedContexts(ctx).length, 0);
});

test("detectBoundedContexts — fires when at least one non-helper class is present (Fathom 5.0.43 / round-8 F6)", () => {
  // Negative-of-the-negative: skip is "ALL class-kind members are
  // helper-modules". When at least one non-helper class is present,
  // the cluster passes through normal bounded-context rules.
  const ctx = buildContext({
    elements: [
      { id: "h1", name: "CognitiveHelpers", kind: "class" },
      { id: "h2", name: "HalsteadHelpers", kind: "class" },
      { id: "u1", name: "AccountManager", kind: "class" },
      { id: "u2", name: "BookkeepingService", kind: "class" },
      { id: "u3", name: "LedgerEntry", kind: "class" },
    ],
    clusters: [{ clusterId: "mixed", name: "cluster-mixed", memberCount: 5 }],
    clusterByElement: new Map([
      ["h1", "mixed"], ["h2", "mixed"], ["u1", "mixed"], ["u2", "mixed"], ["u3", "mixed"],
    ]),
  });
  // With looser thresholds since the fixture is tiny.
  const out = detectBoundedContexts(ctx, {
    minVocabularySize: 2,
    minDistinctiveness: 0.1,
  });
  assert.equal(out.length, 1, "mixed cluster should fire — only ALL-helper clusters are skipped");
});

// --- Fathom row 5.0.1.7: detectors use an O(1) element index ---------------
//
// Pre-fix methodChildren / fieldChildren did linear
// `ctx.elements.find((e) => e.id === id)` per child inside detector
// loops over every class; detectAggregateRoots did `ctx.clusters.find`
// per class. On EnvisionWeb (85K elements, ~5000 classes, 1010
// clusters) this made L7b the dominant L2-L7 phase (14s). Post-fix the
// detectors resolve children + clusters through once-built Maps
// (`indexOf(ctx)`). Rule 4 pin: the detector hot path must NOT call
// `ctx.elements.find` (the index builds via for-of, not .find).

// --- cross-language fixture-path detection (5.0.14.2) -----------------------
//
// Regression: before clauses (a)/(b)/(c) were added to `isFixturePath`,
// C# classes under *-fixtures dirs, .Tests project dirs, or *Tests file
// suffix leaked into DDD detection as entities / value-objects / domain
// services. Each test mirrors the `isFixturePath` predicate inside this
// package (which is kept package-local to avoid a peer-dep — see
// detectors.ts ~lines 128-131).

test("detectEntities — rejects element under *-fixtures dir (5.0.14.2 clause a)", () => {
  // A class under a `fathom-test-fixtures/` path must be excluded from
  // entity detection. Before clause (a) was added, the *-fixtures dir
  // convention was not recognized and such classes leaked as entities.
  const ctx = buildContext({
    elements: [
      {
        id: ":proj:fathom-test-fixtures:dotnet:01-empty.cs#Empty",
        name: "Empty",
        kind: "class",
        artifactId: "/proj/fathom-test-fixtures/dotnet/01-empty.cs",
      },
      { id: ":proj:fathom-test-fixtures:dotnet:01-empty.cs#Empty.id", name: "id", kind: "field" },
      { id: ":proj:fathom-test-fixtures:dotnet:01-empty.cs#Empty.name", name: "name", kind: "field" },
    ],
    classStereotypes: new Map([[":proj:fathom-test-fixtures:dotnet:01-empty.cs#Empty", "entity"]]),
    childrenOf: new Map([
      [":proj:fathom-test-fixtures:dotnet:01-empty.cs#Empty",
        [":proj:fathom-test-fixtures:dotnet:01-empty.cs#Empty.id",
         ":proj:fathom-test-fixtures:dotnet:01-empty.cs#Empty.name"]],
    ]),
  });
  assert.equal(
    detectEntities(ctx).length,
    0,
    "class under *-fixtures dir must be excluded from entity detection (5.0.14.2 clause a)",
  );
});

test("detectEntities — rejects element in .Tests project dir (5.0.14.2 clause b)", () => {
  // C# class in a `Foo.Tests/` project dir: capital-T anchored, must
  // be excluded from entity detection.
  const ctx = buildContext({
    elements: [
      {
        id: "/repo/Foo.Tests/BarTests.cs#BarTests",
        name: "BarTests",
        kind: "class",
        artifactId: "/repo/Foo.Tests/BarTests.cs",
      },
      { id: "/repo/Foo.Tests/BarTests.cs#BarTests.id", name: "id", kind: "field" },
      { id: "/repo/Foo.Tests/BarTests.cs#BarTests.name", name: "name", kind: "field" },
    ],
    classStereotypes: new Map([["/repo/Foo.Tests/BarTests.cs#BarTests", "entity"]]),
    childrenOf: new Map([
      ["/repo/Foo.Tests/BarTests.cs#BarTests",
        ["/repo/Foo.Tests/BarTests.cs#BarTests.id",
         "/repo/Foo.Tests/BarTests.cs#BarTests.name"]],
    ]),
  });
  assert.equal(
    detectEntities(ctx).length,
    0,
    "class in .Tests/ project dir must be excluded from entity detection (5.0.14.2 clause b)",
  );
});

test("detectEntities — rejects element with *Tests.cs file suffix (5.0.14.2 clause c)", () => {
  // C# class named BarTests in a *Tests.cs file: capital-T anchored,
  // must be excluded from entity detection.
  const ctx = buildContext({
    elements: [
      {
        id: "/repo/src/BarTests.cs#BarTests",
        name: "BarTests",
        kind: "class",
        artifactId: "/repo/src/BarTests.cs",
      },
      { id: "/repo/src/BarTests.cs#BarTests.id", name: "id", kind: "field" },
      { id: "/repo/src/BarTests.cs#BarTests.name", name: "name", kind: "field" },
    ],
    classStereotypes: new Map([["/repo/src/BarTests.cs#BarTests", "entity"]]),
    childrenOf: new Map([
      ["/repo/src/BarTests.cs#BarTests",
        ["/repo/src/BarTests.cs#BarTests.id",
         "/repo/src/BarTests.cs#BarTests.name"]],
    ]),
  });
  assert.equal(
    detectEntities(ctx).length,
    0,
    "class in *Tests.cs file must be excluded from entity detection (5.0.14.2 clause c)",
  );
});

test("detectEntities — production path with 'contest' or 'latest' in name is NOT excluded (5.0.14.2 negative)", () => {
  // Capital-T precision: ContestManager.cs and Latest.cs must NOT be
  // caught by clause (c) — only capital-T `Tests?` suffix matches.
  const ctx = buildContext({
    elements: [
      {
        id: "/repo/src/ContestManager.cs#ContestManager",
        name: "ContestManager",
        kind: "class",
        artifactId: "/repo/src/ContestManager.cs",
      },
      { id: "/repo/src/ContestManager.cs#ContestManager.id", name: "id", kind: "field" },
      { id: "/repo/src/ContestManager.cs#ContestManager.name", name: "name", kind: "field" },
    ],
    classStereotypes: new Map([["/repo/src/ContestManager.cs#ContestManager", "entity"]]),
    childrenOf: new Map([
      ["/repo/src/ContestManager.cs#ContestManager",
        ["/repo/src/ContestManager.cs#ContestManager.id",
         "/repo/src/ContestManager.cs#ContestManager.name"]],
    ]),
  });
  assert.equal(
    detectEntities(ctx).length,
    1,
    "ContestManager.cs is a production entity — must NOT be excluded by clause (c)",
  );
});

// --- Full 27-row isFixturePath matrix (5.0.14.2 lockstep invariant) ----------
//
// The `isFixturePath` function inside this package is a byte-identical
// duplicate of `isFixturePathString` in `@kepello/nodegraph-analysis`
// (kept local to avoid a peer-dep). Nothing FAILS if one drifts — so
// this full-matrix suite independently pins the duplicate to the same
// 27-row behavioral contract. A clause drift in detectors.ts (without
// a matching change here) will fail THIS suite; a drift in
// nodegraph-analysis fails its own fixture-paths.test.ts suite.
//
// testing.md Rule 5 / cross-surface coordination invariant (row 5.0.34):
// the `nodegraph-domain-model` copy is pinned by detectors.test.ts
// (this file); the canonical copy is pinned by fixture-paths.test.ts.
//
// isFixturePath(el) reads `el.artifactId ?? el.id` — so the tests
// exercise BOTH: most use `artifactId`, row 4 uses the `id` fallback.
//
// Helper: build a minimal "entity-class" DomainContext for one element.
// Two-field child count satisfies the entity detector's ≥2-field guard.
// `classStereotypes: entity` satisfies the stereotype gate.

function makeEntityCtxWithArtifact(artifactId: string): ReturnType<typeof buildContext> {
  const elId = `el#E`;
  return buildContext({
    elements: [
      { id: elId, name: "E", kind: "class", artifactId },
      { id: `${elId}.f1`, name: "f1", kind: "field" },
      { id: `${elId}.f2`, name: "f2", kind: "field" },
    ],
    classStereotypes: new Map([[elId, "entity"]]),
    childrenOf: new Map([[elId, [`${elId}.f1`, `${elId}.f2`]]]),
  });
}

function makeEntityCtxWithIdFallback(id: string): ReturnType<typeof buildContext> {
  // No `artifactId` — isFixturePath falls back to `el.id`.
  return buildContext({
    elements: [
      { id, name: "E", kind: "class" },
      { id: `${id}.f1`, name: "f1", kind: "field" },
      { id: `${id}.f2`, name: "f2", kind: "field" },
    ],
    classStereotypes: new Map([[id, "entity"]]),
    childrenOf: new Map([[id, [`${id}.f1`, `${id}.f2`]]]),
  });
}

// H1 + H2 positives — must be EXCLUDED from entity detection (result length 0)

// Existing H1 clauses (original six patterns) — spot-checks

test("isFixturePath matrix — row H1a: /tests/ dir segment (existing clause)", () => {
  assert.equal(detectEntities(makeEntityCtxWithArtifact("/proj/src/tests/thing.cs")).length, 0);
});

test("isFixturePath matrix — row H1b: /fixtures/ dir segment (existing clause)", () => {
  assert.equal(detectEntities(makeEntityCtxWithArtifact("/proj/src/fixtures/thing.cs")).length, 0);
});

test("isFixturePath matrix — row H1c: /testdata/ dir segment (existing clause)", () => {
  assert.equal(detectEntities(makeEntityCtxWithArtifact("/proj/src/testdata/thing.cs")).length, 0);
});

test("isFixturePath matrix — row H1d: /__tests__/ dir segment (existing clause)", () => {
  assert.equal(detectEntities(makeEntityCtxWithArtifact("/proj/src/__tests__/thing.ts")).length, 0);
});

test("isFixturePath matrix — row H1e: /__mocks__/ dir segment (existing clause)", () => {
  assert.equal(detectEntities(makeEntityCtxWithArtifact("/proj/src/__mocks__/thing.ts")).length, 0);
});

test("isFixturePath matrix — row H1f: .test. file suffix (existing clause)", () => {
  assert.equal(detectEntities(makeEntityCtxWithArtifact("/proj/src/thing.test.ts#thing")).length, 0);
});

// H2 positives: clause (a) *-fixtures DIR segment

test("isFixturePath matrix — row 1: fathom-test-fixtures/ dir (clause a, slash sep)", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact(".../fathom-test-fixtures/cross-lang-metrics/dotnet/01-empty.cs")).length,
    0,
    "row 1: *-fixtures dir must be excluded (clause a)",
  );
});

test("isFixturePath matrix — row 2: fathom-test-fixtures/ swift path (clause a)", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact(".../fathom-test-fixtures/cross-lang-metrics/swift/01-empty.swift")).length,
    0,
    "row 2: *-fixtures dir swift path must be excluded (clause a)",
  );
});

test("isFixturePath matrix — row 3: fathom-test-fixtures/dotnet-msbuild/ (clause a)", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact(".../fathom-test-fixtures/dotnet-msbuild/Orphan.cs")).length,
    0,
    "row 3: *-fixtures dir must be excluded (clause a)",
  );
});

test("isFixturePath matrix — row 4: colon natural-key with *-fixtures segment (clause a, id fallback)", () => {
  // No artifactId supplied — isFixturePath falls back to el.id.
  // Confirms the `el.artifactId ?? el.id` fallback path in detectors.ts:156.
  assert.equal(
    detectEntities(makeEntityCtxWithIdFallback(
      ":Users:carl:Developer:fathom-test-fixtures:dotnet-msbuild:Orphan.cs",
    )).length,
    0,
    "row 4: colon-sep natural-key *-fixtures path must be excluded via id fallback (clause a)",
  );
});

// H2 positives: clause (b) C# .Tests/.Test project DIR

test("isFixturePath matrix — row 5: /repo/Foo.Tests/BarTests.cs (clause b)", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact("/repo/Foo.Tests/BarTests.cs")).length,
    0,
    "row 5: .Tests/ dir must be excluded (clause b)",
  );
});

test("isFixturePath matrix — row 6: /repo/Foo.Tests/Helper.cs non-test-named file (clause b)", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact("/repo/Foo.Tests/Helper.cs")).length,
    0,
    "row 6: .Tests/ dir must exclude even non-test-named files (clause b)",
  );
});

test("isFixturePath matrix — row 9: /repo/App.Test/Thing.cs singular .Test dir (clause b)", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact("/repo/App.Test/Thing.cs")).length,
    0,
    "row 9: .Test/ singular dir must be excluded (clause b)",
  );
});

// H2 positives: clause (c) *Tests/*Test FILE suffix before .cs/.swift

test("isFixturePath matrix — row 7: /repo/Sources/FooTests.swift (clause c)", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact("/repo/Sources/FooTests.swift")).length,
    0,
    "row 7: *Tests.swift file suffix must be excluded (clause c)",
  );
});

test("isFixturePath matrix — row 8: /repo/src/BarTest.cs singular Test suffix (clause c)", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact("/repo/src/BarTest.cs")).length,
    0,
    "row 8: *Test.cs singular suffix must be excluded (clause c)",
  );
});

// H2 positives: combined clause matches

test("isFixturePath matrix — row 10: /proj/Tests/.../CognitiveTests.swift (existing /Tests/ + clause c)", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact(
      "/proj/Tests/NodegraphAnalyzerSwiftTests/CognitiveTests.swift",
    )).length,
    0,
    "row 10: PascalCase Tests/ dir + *Tests.swift must be excluded",
  );
});

test("isFixturePath matrix — row 11: .../tests/CyclomaticTests.cs (existing /tests/ + clause c)", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact(
      ".../nodegraph-analyzer-dotnet/tests/CyclomaticTests.cs",
    )).length,
    0,
    "row 11: /tests/ dir OR *Tests.cs suffix must be excluded",
  );
});

test("isFixturePath matrix — row 27: Windows backslash .Tests\\ (clause b, backslash sep)", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact("C:\\proj\\Foo.Tests\\BarTests.cs")).length,
    0,
    "row 27: Windows backslash .Tests\\ dir must be excluded (clause b)",
  );
});

// Production negatives — MUST NOT be excluded (result length 1)

test("isFixturePath matrix — row 12: tarjan-scc-fixtures.ts FILE (no trailing sep, clause a must NOT fire)", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact(
      ".../nodegraph-core/src/algorithms/tarjan-scc-fixtures.ts",
    )).length,
    1,
    "row 12: *-fixtures.ts is a FILE (no trailing sep) — clause (a) must NOT fire",
  );
});

test("isFixturePath matrix — row 13: conformance.ts production file", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact(".../nodegraph-core/src/conformance.ts")).length,
    1,
    "row 13: conformance.ts must NOT be excluded",
  );
});

test("isFixturePath matrix — row 14: sqlite.ts production file", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact(".../nodegraph-sqlite/src/sqlite.ts")).length,
    1,
  );
});

test("isFixturePath matrix — row 15: in-memory.ts production file", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact(".../nodegraph-sqlite/src/in-memory.ts")).length,
    1,
  );
});

test("isFixturePath matrix — row 16: Latest.cs — 'Latest' contains 'test' substring but no capital-T boundary", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact("/repo/src/Latest.cs")).length,
    1,
    "row 16: Latest.cs must NOT match — no capital-T 'Test' suffix",
  );
});

test("isFixturePath matrix — row 17: LatestNews.cs production file", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact("/repo/src/LatestNews.cs")).length,
    1,
  );
});

test("isFixturePath matrix — row 18: ContestManager.cs — 'Contest' not a test boundary", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact("/repo/src/ContestManager.cs")).length,
    1,
    "row 18: ContestManager.cs must NOT be excluded",
  );
});

test("isFixturePath matrix — row 19: attestation.ts production file", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact("/repo/src/attestation.ts")).length,
    1,
  );
});

test("isFixturePath matrix — row 20: manifest.ts production file", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact("/repo/src/manifest.ts")).length,
    1,
  );
});

test("isFixturePath matrix — row 21: GreatestHits.swift production file", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact("/repo/Sources/App/GreatestHits.swift")).length,
    1,
    "row 21: GreatestHits.swift must NOT match — no Tests suffix",
  );
});

test("isFixturePath matrix — row 22: test-utils.ts — filename starts with 'test-', no dir segment", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact("/repo/src/test-utils.ts")).length,
    1,
    "row 22: test-utils.ts is a production util — must NOT match",
  );
});

test("isFixturePath matrix — row 23: fixtures.ts FILE named fixtures (no trailing sep)", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact("/repo/src/fixtures.ts")).length,
    1,
    "row 23: fixtures.ts is a FILE (no trailing sep) — must NOT match",
  );
});

test("isFixturePath matrix — row 24: data-fixtures.ts FILE (no trailing sep after *-fixtures token)", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact("/repo/src/data-fixtures.ts")).length,
    1,
    "row 24: data-fixtures.ts is a FILE — clause (a) must NOT fire",
  );
});

test("isFixturePath matrix — row 25: natural-key tarjan-scc-fixtures.ts#tarjanscc (no trailing sep)", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithIdFallback(":...:tarjan-scc-fixtures.ts#tarjanscc")).length,
    1,
    "row 25: *-fixtures.ts#elem natural-key must NOT match (id fallback, no trailing sep)",
  );
});

test("isFixturePath matrix — row 26: lowercase .tests/ dir (deliberately NOT matched by capital-T clause b)", () => {
  assert.equal(
    detectEntities(makeEntityCtxWithArtifact("/repo/foo.tests/thing.cs")).length,
    1,
    "row 26: lowercase .tests/ must NOT match — clause (b) is capital-T anchored",
  );
});

test("detectors — per-class lookups use the index, not Array.find (Fathom 5.0.1.7)", () => {
  const elements: DomainElement[] = [
    { id: "User", name: "User", kind: "class" },
    { id: "User.name", name: "name", kind: "field" },
    { id: "User.email", name: "email", kind: "field" },
    { id: "User.getName", name: "getName", kind: "method" },
    { id: "OrderService", name: "OrderService", kind: "class" },
    { id: "OrderService.place", name: "place", kind: "method" },
  ];
  for (let i = 0; i < 200; i++) {
    elements.push({ id: `decoy${i}`, name: `decoy${i}`, kind: "function" });
  }

  let findCalls = 0;
  const origFind = elements.find.bind(elements);
  (elements as unknown as { find: typeof elements.find }).find = function (...args: Parameters<typeof origFind>) {
    findCalls++;
    return origFind(...args);
  };

  const ctx = buildContext({
    elements,
    classStereotypes: new Map([["User", "entity"], ["OrderService", "service"]]),
    childrenOf: new Map([
      ["User", ["User.name", "User.email", "User.getName"]],
      ["OrderService", ["OrderService.place"]],
    ]),
  });

  // Run the detectors that iterate classes() + call the per-class
  // helpers. Correctness is covered by the dedicated detector tests
  // above; here we pin lookup discipline only.
  detectEntities(ctx);
  detectValueObjects(ctx);
  detectDomainServices(ctx);

  assert.equal(
    findCalls,
    0,
    `detector hot path must resolve children via the elementById index, not Array.find; got ${findCalls} find calls`,
  );
});
