# Changelog

All notable changes to `@kepello/nodegraph-domain-model`. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.5.0] — 2026-05-18

DDD-recovery kind calibration — three coupled fixes addressing round-5 pilot F8 + F9 + F10. Closes Fathom row 5.0.26.

### Added

- **`OPTION_BAG_SUFFIX_RE`** — rejects elements whose name ends in `Options` / `Input` / `Output` / `Metadata` / `Result` / `Args` / `Params` / `Config` / `Spec` / `State` / `Context` / `Snapshot` / `Summary` / `Counts` / `Counters` / `Stats` / `Report` / `Response` / `Request` / `Payload` / `Envelope` / `Update` / `Event` / `Message` / `Filter` / `Query` / `Mutation` / `Selector` / `Predicate` / `Builder` / `Factory`. Applied across `detectEntities` + `detectValueObjects` + `detectDomainServices`. Closes round-5 F8: 30+ option-bags were misclassified as value-objects.
- **`isFixturePath`** — pattern-matches element id for `/tests/` / `/fixtures/` / `/testdata/` / `/__tests__/` / `/__mocks__/` / `.test.<ext>#` / `.spec.<ext>#`. Mirrors fathom-cli's L3-input filter (5.0.14 + 5.0.28 c). Applied across all four DDD detectors. Closes round-5 F9: `app` + `crosslangfixturestests` (C# conformance fixtures) no longer mis-identified as domain-services; `halsteadhelpers` (test helper) no longer mis-identified as entity.
- **TS interface-entity path** (`detectEntities` path 2) — fires on `interface` / `type-alias` with ≥ 3 field-shaped properties AND (≥ 1 implementor OR method children). Distinguishes "structurally-typed entity" (has shape + implementors) from "pure value shape" (which stays as value-object). Closes round-5 F10: TS workspaces previously recovered 0 entities because the rule cascade short-circuited interfaces to `interface` stereotype before reaching the entity rule.

### Tests

- 34/34 tests pass; 4 new regression tests (option-bag rejection, fixture-path rejection, TS interface-entity fires, pure-shape interface stays VO).

## [0.4.0] — 2026-05-18

Fix — `detectValueObjects` adds a second detection path for TS-style interface/type-alias value objects. Closes Fathom row 5.0.17 (a).

### Fixed

- Previous behavior: `detectValueObjects` only fired on `class`/`struct` with L1 classStereotype `data-class`. TS expresses many value objects as pure `interface` declarations (no methods, just shape) — but `interface` short-circuits to `interface` stereotype at the top of the rule cascade, so `data-class` was never reachable for interfaces. Result on Fathom: zero TS value objects recovered despite dozens of `XInput` / `XMetadata` / `XResult` interface shapes.
- New behavior: a second path fires on `interface` / `type-alias` elements with ≥ 2 field-shaped properties and no method children. Confidence scales with field count (0.6 base, +0.1 at ≥ 3 fields, +0.05 at ≥ 5).
- Path 1 (classic data-class) unchanged. The two paths use a `seenIds` set to avoid double-counting an element if it somehow matches both.

### Tests

- 3 new regression tests: fires on TS interface with ≥ 2 fields and no methods; doesn't fire on 1-field interface; doesn't fire on interface with method children.
- All 30/30 package tests pass.

## [0.3.0] — 2026-05-17

Fix — `detectBoundedContexts` filters `realizedBy` to high-signal element kinds. Closes Fathom row 5.1.5.1.

### Fixed

- Pre-fix, bounded-context concepts emitted `realizedBy` edges to every element in their cluster — including parameters, type-parameters, fields, variables. Downstream consumers reading the realizedBy set (LLM-namer prompts, MCP responses) saw parameter NAMES (`input`, `options`, `id`) dominating instead of the class/interface/method TYPE TOKENS that carry concept signal.
- New filter restricts realizedBy to `class / struct / enum / interface / type-alias / method / function / constructor / accessor / operator`. Parameters / type-parameters / fields / variables / imports stay excluded.
- Bounded-contexts with zero high-signal members after filtering are dropped (no longer emitted as concepts).

### Impact

- 5.1.5 Haiku-namer prompts that previously saw 30 `(parameter)` rows now see ~10–20 class/interface/method rows. Verified on the Fathom workspace: top bounded-context's realizedBy was 159 parameter elements pre-fix; post-fix is the 18 interfaces in the file.
- Existing live concepts persist until the next `fathom analyze` run, which tombstones stale concepts via the 5.1.4.1 tombstone-stale-concepts pass.

### Tests

- 27/27 domain-model tests pass. No new test in this ship — the existing test suite covers the detector with class-kind fixtures, which still pass; the change is a filter on real-graph data that test fixtures don't exercise.

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
