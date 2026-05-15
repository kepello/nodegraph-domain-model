/**
 * Domain-concept identity. `conceptId = sha256(conceptKind || '\n' ||
 * name || ('\n' || clusterId)?)` truncated to 16 hex chars. Stable
 * while the concept-kind + name + (optional) cluster assignment hold;
 * changes if any of those shift.
 */

import { createHash } from "node:crypto";

const SHORT_HASH_LENGTH = 16;

export function computeConceptId(
  conceptKind: string,
  name: string,
  clusterId?: string,
): string {
  const hasher = createHash("sha256");
  hasher.update(conceptKind);
  hasher.update("\n");
  hasher.update(name);
  if (clusterId !== undefined) {
    hasher.update("\n");
    hasher.update(clusterId);
  }
  return hasher.digest("hex").slice(0, SHORT_HASH_LENGTH);
}
