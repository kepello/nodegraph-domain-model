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
  };
  const result = recoverDomainModel({ context: ctx });
  assert.equal(result.rawCountsByKind.get("entity"), 1);
  assert.equal(result.rawCountsByKind.get("value-object"), 1);
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
