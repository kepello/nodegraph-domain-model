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
