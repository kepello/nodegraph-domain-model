/**
 * Schema tests. Pins:
 *
 *   - `conceptKind.enum` matches the real `ConceptKind` union exactly
 *     (via `ALL_CONCEPT_KINDS`, the runtime mirror — TS unions aren't
 *     iterable at runtime, so this is the anti-drift enforcement
 *     point; `satisfies readonly ConceptKind[]` on that const already
 *     makes the compiler enforce the reverse direction).
 *   - `conceptKind.enumDescriptions` has exactly one entry per `enum`
 *     value, no more, no less.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { DOMAIN_CONCEPT_METADATA_SCHEMA } from "./schema.js";
import { ALL_CONCEPT_KINDS } from "./types.js";

test("conceptKind.enum — exactly matches ALL_CONCEPT_KINDS (the real ConceptKind union)", () => {
  const prop = DOMAIN_CONCEPT_METADATA_SCHEMA.properties.conceptKind;
  assert.deepEqual(prop.enum, ALL_CONCEPT_KINDS);
});

test("conceptKind.enumDescriptions — one entry per enum value, no extras, no gaps", () => {
  const prop = DOMAIN_CONCEPT_METADATA_SCHEMA.properties.conceptKind;
  const enumValues = prop.enum as readonly string[];
  const descriptions = prop.enumDescriptions as Record<string, string>;
  const descriptionKeys = Object.keys(descriptions);

  assert.deepEqual(
    [...descriptionKeys].sort(),
    [...enumValues].sort(),
    "enumDescriptions keys must match enum values exactly",
  );
  for (const key of enumValues) {
    assert.equal(typeof descriptions[key], "string");
    assert.ok(descriptions[key].length > 0, `enumDescriptions.${key} must be non-empty`);
  }
});
