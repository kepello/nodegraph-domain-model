/**
 * Recovery-runner tests. Pins:
 *
 *   - Empty input → empty result.
 *   - All detectors invoked; rawCountsByKind reports raw counts.
 *   - Threshold filter respects minConfidence.
 *   - Output sorted by descending confidence then kind then name.
 *   - Each returned concept has a computed conceptId.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { recoverDomainModel } from "./recovery.js";
import type { DomainContext } from "./context.js";

function emptyContext(): DomainContext {
  return {
    elements: [],
    classStereotypes: new Map(),
    methodStereotypes: new Map(),
    classRoles: new Map(),
    methodRoles: new Map(),
    childrenOf: new Map(),
    parentOf: new Map(),
    referencesEdges: [],
    inheritsEdges: new Map(),
    clusters: [],
    clusterByElement: new Map(),
    layerByCluster: new Map(),
  };
}

test("recoverDomainModel — empty context returns no concepts", () => {
  const result = recoverDomainModel({ context: emptyContext() });
  assert.equal(result.concepts.length, 0);
});

test("recoverDomainModel — concepts carry conceptId", () => {
  const ctx: DomainContext = {
    ...emptyContext(),
    elements: [{ id: "User", name: "User", kind: "class" }],
    classStereotypes: new Map([["User", "entity"]]),
    classRoles: new Map([["User", "entity-candidate"]]),
  };
  const result = recoverDomainModel({ context: ctx });
  for (const c of result.concepts) {
    assert.equal(typeof c.conceptId, "string");
    assert.equal(c.conceptId.length, 16);
  }
});

test("recoverDomainModel — threshold filter drops low-confidence", () => {
  const ctx: DomainContext = {
    ...emptyContext(),
    elements: [{ id: "Foo", name: "Foo", kind: "class" }],
    classStereotypes: new Map([["Foo", "entity"]]),
    classRoles: new Map([["Foo", "entity-candidate"]]),
  };
  // Entity confidence ~0.7 (no fields) → above default 0.6; passes.
  const baseline = recoverDomainModel({ context: ctx });
  assert.ok(baseline.concepts.length > 0);
  // Crank the threshold so nothing passes.
  const strict = recoverDomainModel({ context: ctx, options: { minConfidence: 0.95 } });
  assert.equal(strict.concepts.length, 0);
});

test("recoverDomainModel — rawCountsByKind reports per-kind raw counts", () => {
  const ctx: DomainContext = {
    ...emptyContext(),
    elements: [
      { id: "User", name: "User", kind: "class" },
      { id: "Address", name: "Address", kind: "class" },
    ],
    classStereotypes: new Map([
      ["User", "entity"],
      ["Address", "data-class"],
    ]),
    classRoles: new Map([
      ["User", "entity-candidate"],
      ["Address", "data-holder"],
    ]),
  };
  const result = recoverDomainModel({ context: ctx });
  assert.equal(result.rawCountsByKind.get("entity"), 1);
  assert.equal(result.rawCountsByKind.get("value-object"), 1);
});

test("recoverDomainModel — kind exclusivity: no element appears under two ConceptKinds (Fathom 5.0.32)", () => {
  // Round-6 pilot F7: `node`, `codeelementref`, `patterninstance` classified
  // as BOTH entity AND value-object. Root cause: TS interface with ≥3 fields,
  // 0 methods, ≥1 implementor qualifies as entity (path 2) AND value-object
  // (path 2 — pure shape) simultaneously. The detectors fire independently;
  // no precedence at the recovery layer.
  //
  // Invariant: each realizedBy elementId appears in at most one concept's
  // realizedByElementIds across the full set of returned concepts.
  // Entity wins on collision (entity > value-object precedence per DDD).
  const ctx: DomainContext = {
    ...emptyContext(),
    elements: [
      { id: "Node", name: "Node", kind: "interface" },
      { id: "Node.id", name: "id", kind: "field" },
      { id: "Node.kind", name: "kind", kind: "field" },
      { id: "Node.metadata", name: "metadata", kind: "field" },
      { id: "AnalysisNode", name: "AnalysisNode", kind: "class" },
    ],
    childrenOf: new Map([["Node", ["Node.id", "Node.kind", "Node.metadata"]]]),
    inheritsEdges: new Map([["AnalysisNode", ["Node"]]]),
  };
  const result = recoverDomainModel({ context: ctx });
  // Same element `Node` qualifies for BOTH entity (3 fields + implementor)
  // and value-object (≥2 fields, 0 methods). Without precedence, it fires
  // twice — this test asserts the post-fix invariant.
  const node = result.concepts.filter((c) =>
    c.realizedByElementIds.includes("Node"),
  );
  assert.equal(
    node.length,
    1,
    `Node appears under ${node.length} concepts: ${node.map((c) => c.conceptKind).join(", ")}`,
  );
  assert.equal(node[0].conceptKind, "entity");

  // General invariant: each elementId appears in at most one concept's
  // realizedByElementIds across the whole result.
  const elementToKinds = new Map<string, Set<string>>();
  for (const c of result.concepts) {
    if (c.conceptKind === "bounded-context" || c.conceptKind === "aggregate-root") {
      // bounded-context realizedBy is cluster-wide and intentionally overlaps
      // with per-element concepts (it groups them); aggregate-root realizedBy
      // points to its anchor entity which legitimately also appears as the
      // entity concept's realizedBy.
      continue;
    }
    for (const id of c.realizedByElementIds) {
      if (!elementToKinds.has(id)) elementToKinds.set(id, new Set());
      elementToKinds.get(id)!.add(c.conceptKind);
    }
  }
  for (const [id, kinds] of elementToKinds) {
    assert.equal(
      kinds.size,
      1,
      `element ${id} appears under multiple ConceptKinds: ${[...kinds].join(", ")}`,
    );
  }
});

test("recoverDomainModel — output sorted by descending confidence", () => {
  // Construct a context where two concepts get different confidence levels.
  const ctx: DomainContext = {
    ...emptyContext(),
    elements: [
      { id: "Rich", name: "Rich", kind: "class" },
      { id: "Rich.f1", name: "f1", kind: "field" },
      { id: "Rich.f2", name: "f2", kind: "field" },
      { id: "Rich.f3", name: "f3", kind: "field" },
      { id: "Poor", name: "Poor", kind: "class" },
    ],
    classStereotypes: new Map([
      ["Rich", "entity"],
      ["Poor", "entity"],
    ]),
    classRoles: new Map([
      ["Rich", "entity-candidate"],
      ["Poor", "entity-candidate"],
    ]),
    childrenOf: new Map([["Rich", ["Rich.f1", "Rich.f2", "Rich.f3"]]]),
  };
  const result = recoverDomainModel({ context: ctx });
  // Rich (3 fields → 0.85 confidence) should sort before Poor (0 fields → 0.7).
  const richIdx = result.concepts.findIndex((c) => c.name === "Rich");
  const poorIdx = result.concepts.findIndex((c) => c.name === "Poor");
  assert.ok(richIdx >= 0);
  assert.ok(poorIdx >= 0);
  assert.ok(richIdx < poorIdx);
});

test("recoverDomainModel — REGRESSION 5.0.21.3: same-identity concepts MERGE (union realizers), never duplicate conceptIds", () => {
  // Two same-named classes (e.g. .NET same-name-different-namespace
  // landing in one cluster scope) detected as entities compute the
  // same conceptId (kind+name+clusterId). Pre-fix both were returned;
  // the second insertConcept superseded the first → 1 live node for 2
  // emitted (the EnvisionWeb 1,165→1,153 loss). Identity says they're
  // ONE concept with two realizers — merge.
  const ctx: DomainContext = {
    ...emptyContext(),
    elements: [
      { id: "ns1/User", name: "User", kind: "class" },
      { id: "ns2/User", name: "User", kind: "class" },
    ],
    classStereotypes: new Map([
      ["ns1/User", "entity"],
      ["ns2/User", "entity"],
    ]),
    classRoles: new Map([
      ["ns1/User", "entity-candidate"],
      ["ns2/User", "entity-candidate"],
    ]),
  };
  const result = recoverDomainModel({ context: ctx });
  const ids = result.concepts.map((c) => c.conceptId);
  assert.equal(new Set(ids).size, ids.length, "no duplicate conceptIds");
  const entities = result.concepts.filter((c) => c.conceptKind === "entity");
  assert.equal(entities.length, 1);
  assert.deepEqual(
    [...entities[0].realizedByElementIds].sort(),
    ["ns1/User", "ns2/User"],
  );
});

// --- Wave-3a refusal returns (Fathom row 3.1.8.4, §S7 wave 3a) -------------

test("refusals — below-confidence-threshold carries {score, threshold, conceptKind} (raised threshold; :86 gate)", () => {
  const ctx: DomainContext = {
    ...emptyContext(),
    elements: [{ id: "Foo", name: "Foo", kind: "class" }],
    classStereotypes: new Map([["Foo", "entity"]]),
    classRoles: new Map([["Foo", "entity-candidate"]]),
  };
  // Entity with no fields scores 0.7 — passes the default 0.6, fails 0.95.
  const result = recoverDomainModel({ context: ctx, options: { minConfidence: 0.95 } });
  assert.equal(result.concepts.length, 0);
  const refusals = result.refusals.filter(
    (r) => r.reason === "below-confidence-threshold",
  );
  assert.equal(refusals.length, 1);
  assert.equal(refusals[0].candidateRef, "Foo");
  assert.equal(refusals[0].detail.score, 0.7);
  assert.equal(refusals[0].detail.threshold, 0.95);
  assert.equal(refusals[0].detail.conceptKind, "entity");
});

test("refusals — DEAD-GATE PIN: at the DEFAULT threshold (0.6) no detector can score below it (all score floors ≥ 0.6)", () => {
  // Score floors: entity 0.6 · value-object 0.6 · domain-service 0.65 ·
  // aggregate-root > 0.6 · bounded-context ≥ 0.7. The :86 gate only
  // fires under an operator-raised minConfidence — pinned so a future
  // scoring change that CAN dip below 0.6 shows up as a broken pin, not
  // a silent new refusal source.
  const ctx: DomainContext = {
    ...emptyContext(),
    elements: [
      { id: "Foo", name: "Foo", kind: "class" },
      { id: "Bar", name: "Bar", kind: "class" },
    ],
    classStereotypes: new Map([["Foo", "entity"], ["Bar", "data-class"]]),
    classRoles: new Map([["Foo", "entity-candidate"], ["Bar", "data-holder"]]),
  };
  const result = recoverDomainModel({ context: ctx });
  assert.equal(
    result.refusals.filter((r) => r.reason === "below-confidence-threshold").length,
    0,
  );
});

test("refusals — kind-precedence-excluded for a value-object shadowed by an entity (:62-67 filter; the 5.0.32 fixture)", () => {
  // The ONLY reachable precedence overlap today: interface-shaped —
  // ≥3 fields + implementor(s) + 0 methods qualifies as entity (path 2)
  // AND value-object (path 2) on the same element. Class-path overlaps
  // are role-disjoint (entity-candidate vs data-holder vs service) so
  // classes can never reach the filter; domain-service exclusion is
  // structurally unreachable (DS scans classes only, entity path 2
  // admits interfaces/type-aliases only).
  const ctx: DomainContext = {
    ...emptyContext(),
    elements: [
      { id: "Node", name: "Node", kind: "interface" },
      { id: "Node.id", name: "id", kind: "field" },
      { id: "Node.kind", name: "kind", kind: "field" },
      { id: "Node.metadata", name: "metadata", kind: "field" },
      { id: "AnalysisNode", name: "AnalysisNode", kind: "class" },
    ],
    childrenOf: new Map([["Node", ["Node.id", "Node.kind", "Node.metadata"]]]),
    inheritsEdges: new Map([["AnalysisNode", ["Node"]]]),
  };
  const result = recoverDomainModel({ context: ctx });
  const refusals = result.refusals.filter(
    (r) => r.reason === "kind-precedence-excluded",
  );
  assert.equal(refusals.length, 1);
  assert.equal(refusals[0].candidateRef, "Node");
  assert.equal(refusals[0].detail.conceptKind, "value-object");
  assert.equal(refusals[0].detail.excludedBy, "entity");
});

test("refusals — detector near-misses (no-entity-shape) surface through recoverDomainModel's return", () => {
  // A data-holder with a mutator: VO path-1's post-admission evidence
  // gate — near-miss shaped (L1 said data-holder; L7b refused on
  // behaviour evidence).
  const ctx: DomainContext = {
    ...emptyContext(),
    elements: [
      { id: "Acct", name: "Acct", kind: "class" },
      { id: "Acct.set", name: "setBalance", kind: "method" },
    ],
    classStereotypes: new Map([["Acct", "data-class"]]),
    classRoles: new Map([["Acct", "data-holder"]]),
    methodRoles: new Map([["Acct.set", "mutator"]]),
    childrenOf: new Map([["Acct", ["Acct.set"]]]),
  };
  const result = recoverDomainModel({ context: ctx });
  const refusals = result.refusals.filter((r) => r.reason === "no-entity-shape");
  assert.equal(refusals.length, 1);
  assert.equal(refusals[0].candidateRef, "Acct");
  assert.equal(refusals[0].detail.conceptKind, "value-object");
});

test("refusals — CLAIM CONSERVATION: Σ rawCountsByKind = concepts + mergedClaimCount + post-claim refusals", () => {
  // Post-claim refusals = kind-precedence-excluded + below-confidence-
  // threshold (they consume raw claims). Detector-internal near-misses
  // (no-entity-shape) are PRE-claim — they never entered rawCountsByKind
  // and expand IN separately in wave 3b.
  const ctx: DomainContext = {
    ...emptyContext(),
    elements: [
      // Merge pair: same (kind, name, clusterId) → 2 raw claims, 1 concept.
      { id: "ns1/User", name: "User", kind: "class" },
      { id: "ns2/User", name: "User", kind: "class" },
      // Precedence overlap: entity + value-object on the same interface.
      { id: "Node", name: "Node", kind: "interface" },
      { id: "Node.id", name: "id", kind: "field" },
      { id: "Node.kind", name: "kind", kind: "field" },
      { id: "Node.metadata", name: "metadata", kind: "field" },
      { id: "AnalysisNode", name: "AnalysisNode", kind: "class" },
      // Pre-claim near-miss: data-holder with a mutator (NOT in rawCounts).
      { id: "Acct", name: "Acct", kind: "class" },
      { id: "Acct.set", name: "setBalance", kind: "method" },
    ],
    classStereotypes: new Map([
      ["ns1/User", "entity"],
      ["ns2/User", "entity"],
      ["Acct", "data-class"],
    ]),
    classRoles: new Map([
      ["ns1/User", "entity-candidate"],
      ["ns2/User", "entity-candidate"],
      ["Acct", "data-holder"],
    ]),
    methodRoles: new Map([["Acct.set", "mutator"]]),
    childrenOf: new Map([
      ["Node", ["Node.id", "Node.kind", "Node.metadata"]],
      ["Acct", ["Acct.set"]],
    ]),
    inheritsEdges: new Map([["AnalysisNode", ["Node"]]]),
  };
  const result = recoverDomainModel({ context: ctx });
  const rawTotal = [...result.rawCountsByKind.values()].reduce((s, n) => s + n, 0);
  const postClaim = result.refusals.filter(
    (r) =>
      r.reason === "kind-precedence-excluded" ||
      r.reason === "below-confidence-threshold",
  ).length;
  assert.equal(
    rawTotal,
    result.concepts.length + result.mergedClaimCount + postClaim,
    "claim conservation: every raw detector claim is a concept, a merge, or a named post-claim refusal",
  );
  assert.equal(result.mergedClaimCount, 1, "the ns1/ns2 User pair collapses to one concept");
  // The pre-claim near-miss is present but does NOT participate in the
  // raw-claims identity.
  assert.equal(result.refusals.filter((r) => r.reason === "no-entity-shape").length, 1);
});
