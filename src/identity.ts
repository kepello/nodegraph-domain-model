/**
 * Domain-concept identity. `conceptId = sha256(conceptKind || '\n' ||
 * name || ('\n' || clusterId)?)` truncated to 16 hex chars. Stable
 * while the concept-kind + name + (optional) cluster assignment hold;
 * changes if any of those shift.
 */

import { shortContentHash } from "@kepello/nodegraph-core";

export function computeConceptId(
  conceptKind: string,
  name: string,
  clusterId?: string,
): string {
  return shortContentHash(
    clusterId !== undefined ? [conceptKind, name, clusterId] : [conceptKind, name],
  );
}
