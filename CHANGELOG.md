# Changelog

All notable changes to `@kepello/nodegraph-domain-model`. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.2.0] — 2026-05-15

Closes Fathom row `l7b-bounded-context-threshold-tuning` (3.2.4) — fourth Tier-1 fix from the 2026-05-14 Phase 3 smoke. Bounded-context detection is no longer over-permissive when call edges are sparse.

### Changed

- `detectBoundedContexts` tightens its detection thresholds:
  - **Vocabulary floor**: new `minVocabularySize: number` option (default `5`). Clusters with fewer than 5 distinct identifier terms can't carry enough vocabulary to be a bounded context. Filters out the noisy tail (small clusters where every term is technically "unique" but there are only 1-2 terms total).
  - **Distinctiveness threshold**: raised from `0.2` to `0.4` via new `minDistinctiveness: number` option (default `0.4`). Phase 3 smoke against the Fathom workspace had flagged 313/578 (54%) clusters as bounded contexts — the 0.2 threshold was too permissive when clusters are mostly singletons.
- Existing positive-case test fixture grows from 3 to 5 members per cluster to clear the new vocab floor under default options.

### Added

- New `minVocabularySize` + `minDistinctiveness` options on `detectBoundedContexts`. Both expose tuning for downstream workspaces that want different rigor levels (e.g., a very tight 0.6 distinctiveness for high-precision audit work).
- 3 new regression tests in `detectors.test.ts`: below-vocab-floor → no fire; below-distinctiveness-threshold → no fire; loosened options recover permissive v1 behavior.

### Downstream impact

- Bounded-context counts on real workspaces will drop substantially when call-edge signal is sparse (as on Fathom). The change makes detection conservative-by-default; callers wanting the v1 permissive behavior pass `{ minVocabularySize: 1, minDistinctiveness: 0.2 }`.
- Pre-prod migration: rebuild `.fathom/graph.db` to clear stale bounded-context concepts.

## [0.1.0] — 2026-05-14

Initial publish. Seventh-b layer of the workspace Layered Code Abstraction arc (Fathom work row `l7b-domain-model-recovery` 3.1.8, per `docs/code_abstraction.md` L7). Final row of Phase 3.

### Added

- `DOMAIN_CONCEPT_DOMAIN` + `DOMAIN_CONCEPT_METADATA_SCHEMA` + indexes (`concepts_by_concept_id` unique, `concepts_by_concept_kind`, `concepts_by_cluster`, `concepts_by_language`).
- `DomainConceptMetadata`, `DomainConceptInput`, `DomainConceptNode`, `DomainModelOverlay` interfaces. `ConceptKind` enum: `entity` | `value-object` | `aggregate-root` | `domain-service` | `bounded-context`.
- `makeDomainModelOverlay(graph)` factory — registers domain + indexes; exposes write/read API with `containsConcept` / `realizedBy` / `partOfContext` / `relatedTo` edges per the L7 row's design.
- `recoverDomainModel({ context, options? })` — composite recovery runner. Invokes per-kind detectors, applies confidence threshold (default 0.6), returns ordered `ComputedConcept[]`.
- Per-kind detector functions exported individually: `detectEntities`, `detectValueObjects`, `detectAggregateRoots`, `detectDomainServices`, `detectBoundedContexts`.
- `computeConceptId(conceptKind, name, clusterId?)` — stable content-hash identity helper.

### Detection heuristics (v1)

| Concept | Signals |
| --- | --- |
| entity | L1 class stereotype `entity` |
| value-object | L1 class stereotype `data-class` AND no `mutator-shaped` method children |
| aggregate-root | entity with the most references to other entities in the same cluster (one per cluster, when ≥2 entities exist) |
| domain-service | L1 class stereotype `controller` / `command` + few/no field children |
| bounded-context | L3 cluster with ≥ 3 members + uniform layer when L4 available + distinctive identifier vocabulary |

### Trade-offs (v1 — documented limitations)

- **L1 class stereotypes are coarse** — without Wirfs-Brock role stereotypes (`l1b-role-stereotypes` 3.1.1.2, Parked), aggregate-root + domain-service detection lean on classStereotype proxies; precision is modest.
- **No business rule extraction in v1** — Sneed-style BRE parked as Fathom `l7-business-rule-extraction` (3.1.8.2).
- **Context map relationships unlabeled** — `relatedTo` edges emitted between bounded contexts but DDD relationship typing (customer/supplier, conformist, ACL) parked as `l7-context-map-relationships` (3.1.8.3).
- **No cross-language domain model** — concepts stay per-language; parked as `l7-cross-language-domain-model` (3.1.8.4).
- **Operator review is config-based** — interactive MCP parked as `l7-operator-mcp-interactive` (3.1.8.1).
- **Detection is candidate-only**; treat outputs as proposals, not ground truth.

### Schema-versioning note

Registers without `schemaVersion` because `nodegraph-core@1.1.1` doesn't yet enforce the field. Will declare `schemaVersion: 1` when Fathom row `overlay-version-and-migration-substrate` (1.12.2) ships. Same posture as the other Phase-3 packages.
