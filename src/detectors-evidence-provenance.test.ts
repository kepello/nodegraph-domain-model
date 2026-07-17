/**
 * `evidenceProvenance` ratchet (Fathom row
 * `identifier-derived-verdicts-claim-deterministic-authority`, 3.1.8.1).
 *
 * THE GUARD IS THE DELIVERABLE, not just the field: this file PINS the
 * provenance of every L7b concept kind the 3.1.8.1 census found, so a
 * future change cannot silently claim `"structural"` while consulting a
 * name. Provenance is CONSTANT per `conceptKind` (not per-instance — see
 * `detectors.ts` for the per-detector rationale):
 *
 *   - `entity` / `value-object` / `domain-service` — always `"mixed"`
 *     (survives the isFixturePath/isHelperModule/OPTION_BAG_SUFFIX_RE
 *     name-based rejection gates, every emission, every path).
 *   - `bounded-context` — always `"name"` (vocabulary distinctiveness is
 *     100% identifier-derived; no emission is possible without it).
 *   - `aggregate-root` — always `"structural"` (its OWN root-selection
 *     logic reads only reference counts).
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
  classRoles?: ReadonlyMap<string, string>;
  methodRoles?: ReadonlyMap<string, string>;
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
    classRoles: b.classRoles ?? new Map(),
    methodRoles: b.methodRoles ?? new Map(),
    childrenOf: b.childrenOf ?? new Map(),
    parentOf: b.parentOf ?? new Map(),
    referencesEdges: b.referencesEdges ?? [],
    inheritsEdges: b.inheritsEdges ?? new Map(),
    clusters: b.clusters ?? [],
    clusterByElement: b.clusterByElement ?? new Map(),
    layerByCluster: b.layerByCluster ?? new Map(),
  };
}

// ============================================================================
// entity — always `mixed` (both the classRole path and the TS
// interface-shaped path).
// ============================================================================

test("detectEntities — classRole path is `mixed`", () => {
  const ctx = buildContext({
    elements: [
      { id: "User", name: "User", kind: "class" },
      { id: "User.name", name: "name", kind: "field" },
      { id: "User.email", name: "email", kind: "field" },
    ],
    classStereotypes: new Map([["User", "entity"]]),
    classRoles: new Map([["User", "entity-candidate"]]),
    childrenOf: new Map([["User", ["User.name", "User.email"]]]),
  });
  const out = detectEntities(ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].evidenceProvenance, "mixed");
});

test("detectEntities — TS interface-shaped path is `mixed`", () => {
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
  assert.ok(user !== undefined);
  assert.equal(user.evidenceProvenance, "mixed");
});

// ============================================================================
// value-object — always `mixed` (both paths).
// ============================================================================

test("detectValueObjects — classRole path is `mixed`", () => {
  const ctx = buildContext({
    elements: [
      { id: "Money", name: "Money", kind: "class" },
      { id: "Money.amount", name: "amount", kind: "field" },
    ],
    classRoles: new Map([["Money", "data-holder"]]),
    childrenOf: new Map([["Money", ["Money.amount"]]]),
  });
  const out = detectValueObjects(ctx).concepts;
  assert.equal(out.length, 1);
  assert.equal(out[0].evidenceProvenance, "mixed");
});

test("detectValueObjects — TS interface-shaped path is `mixed`", () => {
  const ctx = buildContext({
    elements: [
      { id: "Money", name: "Money", kind: "interface" },
      { id: "Money.amount", name: "amount", kind: "field" },
      { id: "Money.currency", name: "currency", kind: "field" },
    ],
    childrenOf: new Map([["Money", ["Money.amount", "Money.currency"]]]),
  });
  const out = detectValueObjects(ctx).concepts;
  assert.equal(out.length, 1);
  assert.equal(out[0].evidenceProvenance, "mixed");
});

// ============================================================================
// domain-service — always `mixed`.
// ============================================================================

test("detectDomainServices — is `mixed`", () => {
  const ctx = buildContext({
    elements: [
      { id: "Coord", name: "OrderCoordinator", kind: "class" },
      { id: "Coord.handle", name: "handle", kind: "method" },
    ],
    classStereotypes: new Map([["Coord", "controller"]]),
    classRoles: new Map([["Coord", "service"]]),
    childrenOf: new Map([["Coord", ["Coord.handle"]]]),
    clusters: [{ clusterId: "c1", name: "orders", memberCount: 1 }],
    clusterByElement: new Map([["Coord", "c1"]]),
  });
  const out = detectDomainServices(ctx).concepts;
  assert.equal(out.length, 1);
  assert.equal(out[0].evidenceProvenance, "mixed");
});

// ============================================================================
// bounded-context — always `name`.
// ============================================================================

test("detectBoundedContexts — is `name`", () => {
  const ctx = buildContext({
    elements: [
      { id: "e1", name: "OrderService", kind: "class" },
      { id: "e2", name: "OrderRepository", kind: "class" },
      { id: "e3", name: "OrderItem", kind: "class" },
      { id: "e7", name: "OrderCheckout", kind: "class" },
      { id: "e8", name: "OrderConfirmation", kind: "class" },
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
  assert.ok(out.length >= 1, "expected at least one bounded-context to fire");
  for (const c of out) assert.equal(c.evidenceProvenance, "name");
});

// ============================================================================
// aggregate-root — always `structural`.
// ============================================================================

test("detectAggregateRoots — is `structural`", () => {
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
    classRoles: new Map([
      ["Order", "entity-candidate"],
      ["OrderLine", "entity-candidate"],
      ["OrderItem", "entity-candidate"],
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
  assert.equal(out[0].evidenceProvenance, "structural");
});
