/**
 * Identity-hash tests. Pins:
 *
 *   - Golden byte-identity across the shortContentHash migration
 *     (identity-hash-helper-consolidation, Fathom row 0.3.2.f8 step 2).
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { computeConceptId } from "./identity.js";

test("computeConceptId — golden pin, with clusterId (byte-identity across the shortContentHash migration)", () => {
  // Captured against the pre-migration sha256(conceptKind + '\n' + name +
  // '\n' + clusterId) assembly. Must stay byte-identical after routing
  // through the shared shortContentHash helper — id churn here is a
  // supersession storm.
  const id = computeConceptId("entity", "Invoice", "cluster-golden-1");
  assert.equal(id, "da42df2c325125d1");
});

test("computeConceptId — golden pin, no clusterId (byte-identity across the shortContentHash migration)", () => {
  const id = computeConceptId("entity", "Invoice");
  assert.equal(id, "da538e6c4aae4cd1");
});
