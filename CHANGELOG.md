# Changelog

All notable changes to `@kepello/nodegraph-domain-model`. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.17.0] — 2026-07-10

`computeConceptId` migrated onto `@kepello/nodegraph-core`'s shared `shortContentHash` helper. Step 2 of Fathom row `0.3.2.f8` (identity-hash-helper-consolidation). Behavior-preserving — golden-pinned; no id change → no downstream cache concern from this package.

### Changed

- `computeConceptId` now calls `shortContentHash(clusterId !== undefined ? [conceptKind, name, clusterId] : [conceptKind, name])` instead of hand-rolling the sha256-then-slice(0,16) assembly (positional parts, no sort). Local `SHORT_HASH_LENGTH` const removed.
- Peer dependency on `@kepello/nodegraph-core` retargeted `^5.7.1` → `^5.12.0` (introduces `shortContentHash`).

### Tests

- New `src/identity.test.ts` (none previously existed) — 2 golden-pin regression tests: fixed inputs with and without `clusterId` assert the exact pre-migration literals `da42df2c325125d1` and `da538e6c4aae4cd1`. Captured green against the un-migrated code, stayed green after the migration — byte-identity confirmed. 87/87 tests pass (was 85).

## [0.16.0] — 2026-07-06

**`conceptKind` gains a curated, documented value catalog in the metadata schema.** The inspector's `enum` → chip-rendering consumer (`@kepello/nodegraph-core` `MetadataSchemaProperty`) had a bare list of five strings with no explanation of what each one means; an operator staring at a `bounded-context` chip had no way to learn what fired it without reading `detectors.ts`.

### Added

- `DOMAIN_CONCEPT_METADATA_SCHEMA`'s `conceptKind` property gains `enumDescriptions: Record<ConceptKind, string>` — one DDD-grounded sentence per kind, each tied to the actual detector logic in `detectors.ts` (stereotype gates, field/method thresholds, cluster thresholds), not textbook DDD in the abstract.
- `types.ts` exports `ALL_CONCEPT_KINDS` — a runtime mirror of the `ConceptKind` union (`as const satisfies readonly ConceptKind[]`, so the compiler flags drift between the array and the union). Public API surface via `index.ts`.

### Tests

- New `src/schema.test.ts` — 2 tests: `conceptKind.enum` deep-equals `ALL_CONCEPT_KINDS` (pins the schema's enum against the real `ConceptKind` union); every `enum` value has exactly one matching `enumDescriptions` entry, no extras, no gaps. RED witnessed by temporarily dropping `bounded-context` from the schema's `enum` array — both tests failed with the expected diff; restored to GREEN unchanged.

Suite: 85 pass (was 83).

## [0.15.0] — 2026-07-01

**Full 27-row `isFixturePath` matrix suite enforces lockstep invariant** (Fathom row `fixture-path-detection-cross-language` 5.0.14.2 reviewer fix F2). The package-local `isFixturePath` in `detectors.ts` is a byte-identical duplicate of `isFixturePathString` in `@kepello/nodegraph-analysis` — kept local to avoid a peer-dep (see detectors.ts ~lines 128-131). Before this version nothing FAILED if one drifted; the cross-surface-coordination.test.ts comment in nodegraph-analysis falsely implied it also pinned the `detectors.ts` copy (it only exercises the canonical via L1 stereotype derivations). This version adds the complete 27-row behavioral matrix to `detectors.test.ts` so a clause drift in EITHER copy fails its own package suite. No code changes — tests only.

### Tests

- **`src/detectors.test.ts` — 33 new tests** across the full 27-row matrix (6 H1 spot-checks of the original six clauses + all 12 H2 positives + 15 production negatives, two rows exercised via the `id` fallback path): `isFixturePath matrix — row N: ...`. Uses two helpers: `makeEntityCtxWithArtifact(artifactId)` (calls detector with `el.artifactId`); `makeEntityCtxWithIdFallback(id)` (no `artifactId` — exercises the `el.artifactId ?? el.id` fallback). RED witnessed: temporarily removing clause (a) failed rows 1–4 (and the existing clause-a regression); GREEN restored at code unchanged.

Suite: 83 pass (was 50).

## [0.14.0] — 2026-07-01

**Cross-language fixture-path detection broadened in `isFixturePath` (lockstep with canonical)** (Fathom row `fixture-path-detection-cross-language` 5.0.14.2). The package-local `isFixturePath` predicate (kept local to avoid a peer-dep on `@kepello/nodegraph-analysis` — see detectors.ts ~lines 128-131) gains the same three clauses simultaneously shipped in the canonical `isFixturePathString`: (a) `*-fixtures/` dir segment, (b) `.Tests`/`.Test` project dir (capital-T), (c) `*Tests.cs`/`*Tests.swift` file suffix (capital-T). Both bodies must remain byte-identical per the cross-surface coordination invariant (row 5.0.34). Pre-prod: delete + re-analyze clears any leaked fixture elements from DDD detection.

### Fixed

- **`src/detectors.ts` → `isFixturePath`** — three new clauses appended, byte-identical to `nodegraph-analysis@3.33.0`'s `isFixturePathString` clauses (a)/(b)/(c). C# classes under `*-fixtures/` dirs, `.Tests/` project dirs, or `*Tests.cs`/`*Tests.swift` files are now correctly excluded from `detectEntities`, `detectValueObjects`, `detectDomainServices`.

### Tests

- 4 new regressions in `src/detectors.test.ts`: (a) entity rejected for class under `*-fixtures/` dir; (b) entity rejected for class in `.Tests/` dir; (c) entity rejected for class in `*Tests.cs` file; (d) production entity NOT excluded — `ContestManager.cs` still fires as entity (capital-T precision guard).

Suite: 50 pass (was 46).

## [0.13.0] — 2026-06-09

**Same-identity concepts merge instead of colliding** (Fathom row `l7b-domain-concept-count-discrepancy` 5.0.21.3 — EnvisionWeb 1,165 emitted → 1,153 live, 12 silently lost).

### Fixed

- `recoverDomainModel` now merges concepts whose `(conceptKind, name, clusterId)` identity triple — and therefore `conceptId` — coincide (e.g. same-named .NET classes from different namespaces in one cluster scope): union of `realizedByElementIds` (sorted), max `confidenceScore`, union of contains/relatedTo name lists, language kept only when the halves agree. Pre-fix both concepts were returned; the second `insertConcept` silently superseded the first, losing one live node per collision pair and dropping the first's realizers. Identity semantics say they ARE one concept with multiple realizers — now the output count equals the persisted live count.

### Tests

- 1 regression (two same-named entities → one merged concept, no duplicate conceptIds). 46 pass.

## [0.12.0] — 2026-05-28

Adopt the per-overlay schema-version stamp (Fathom row 1.12.3). Exports `DOMAIN_CONCEPT_SCHEMA_VERSION` (= 1, V1 baseline) and declares it on the overlay's `OverlayRegistration`.

### Changed

- Registration now passes the mandatory `schemaVersion` field added in substrate 1.12.2. Peer dependency on `@kepello/nodegraph-core` retargeted to `^3.0.0`. No behavior change beyond the version stamp.

## [0.11.0] — 2026-05-28

O(N²)→O(N) detector element lookups. Fathom row `perf-l7b-domain-model-linear-element-lookup` (5.0.1.7) — sibling of the L6 fix (5.0.1.6).

### Fixed

- `methodChildren` and `fieldChildren` did a linear `ctx.elements.find((e) => e.id === id)` per child, inside detector loops over every class (`detectEntities` / `detectValueObjects` / `detectDomainServices` / `detectAggregateRoots` iterate `classes()` or `ctx.elements` and call them). `classes()` re-`filter`ed all elements per detector, and `detectAggregateRoots` did `ctx.clusters.find(...)` per class. On the EnvisionWeb .NET workspace (85,353 elements, ~5000 classes, 1010 clusters) this made L7b `recoverDomainModel` the dominant L2-L7 sub-phase at **14s — 34% of the (post-L6-fix) 41.4s abstractions compute**.
- New `indexOf(ctx)` builds — once per `recoverDomainModel` run, cached by context identity in a `WeakMap` — an `elementById: Map`, a `classList`, and a `clusterById: Map`. `recoverDomainModel` passes the same `DomainContext` to all five detectors, so the index builds once and is reused. Helpers resolve O(1). No `DomainContext` type change, no caller change.

### Tests

1 new Rule-4 pin in `detectors.test.ts` (spy on `elements.find`): the detector hot path does ZERO `Array.find` calls — children + clusters resolve via the indexes. Existing 44 cases unchanged; 45/45.

## [0.10.0] — 2026-05-19

Adds — helper-module name-suffix exclusion across all DDD recovery detectors. Closes Fathom row 5.0.43 (round-8 F6 dotnet partial-class helper leak into bounded-contexts).

### Added

- **`HELPER_MODULE_SUFFIX_RE` + `isHelperModule(el)` (local)** — name-suffix predicate matching `/Helpers?$/i` on `DomainElement.name`. Mirrors the `isHelperModuleName` predicate in `@kepello/nodegraph-analysis` (kept package-local to avoid a peer-dep, parallel to the local `isFixturePath` copy).
- **Helper-module skips** in DDD detectors:
  - `detectEntities` paths 1 + 2: helper-module rejected (alongside fixture-path + option-bag suffix).
  - `detectValueObjects` paths 1 + 2: helper-module rejected.
  - `detectDomainServices`: helper-module rejected.
  - `detectBoundedContexts`: cluster skipped when ALL class-kind realizedBy elements are helper-modules. The check is **dominance-based** (all class-kind members must be helper-suffixed) — mixed clusters with at least one non-helper class fall through to normal bounded-context rules.

### Why

Round-8 F6 substrate audit observed `cluster-halsteadhelpers`, `cluster-cognitivehelpers/state`, `cluster-intraclasshelpers`, `cluster-projectfilehelpers` surface as bounded-context concepts in the live Fathom substrate (csharp, no llmName). These are code-organization partial classes in `nodegraph-analyzer-dotnet`'s Roslyn host, not domain concepts. Same exclusion shape as the 5.0.26(b) fixture-path filter but name-suffix-based.

### Tests

- 44/44 (now 49 with new helper-module fixtures) tests pass. New cases: entity / value-object / service rejection; bounded-context skip when all class-kind members are helper-suffixed; bounded-context fires when at least one non-helper class is present (negative-of-the-negative).

## [0.9.0] — 2026-05-19

Adds — capture domain-scoped mutator at `registerOverlay` time. Closes Fathom row 5.0.42 (nodegraph-core@2.0.0 GraphReader/GraphMutator split adoption).

## [0.8.0] — 2026-05-19

Adds — `DomainModelOverlay.setEnrichment(conceptId, llmEnrichment)` + `DomainConceptMetadata.llmEnrichment?` field. Fixes latent bug in `renameConcept`. Closes Fathom row 5.0.39 (concept half). TDD-driven.

### Added

- **`setEnrichment(conceptId, llmEnrichment)`** — writes `metadata.llmEnrichment` and re-emits `realizedBy` / `partOfContext` / `relatedTo` edges through a private `supersedeWithMetadata` helper. The ONLY correct path to persist LLM enrichment on a concept.
- **`DomainConceptMetadata.llmEnrichment?`** — typed surface for the enrichment record (`name`, `displayName`, `summary`, `provenance`). Persisted by `setEnrichment`.

### Fixed

- **`renameConcept` no longer strips outgoing edges**. Same shape as the `renameCluster` bug in `nodegraph-clusters@0.7.0`: prior implementation called `graph.supersedeNode` directly; the substrate cascade tombstoned `realizedBy` / `partOfContext` / `relatedTo` outgoing edges. Now routes through `supersedeWithMetadata`: captures the prior tip's edge targets per type before supersede, re-emits them from the new tip after.

### Internal

- New `supersedeWithMetadata(conceptId, transform)` helper. Both `renameConcept` and `setEnrichment` route through it; future metadata-only supersedes follow the same path.

### Tests

- 2 new regression tests: `renameConcept — PRESERVES realizedBy edges through supersede (Fathom 5.0.39)` + `setEnrichment — preserves realizedBy edges and writes llmEnrichment (Fathom 5.0.39)`. Both RED pre-fix, GREEN post-fix.
- 39/39 tests pass.

## [0.7.0] — 2026-05-19

Adds — `detectEntities` accepts the `large-class` L1 stereotype when entity-shape holds (≥3 fields + ≥3 method children). Closes Fathom row 5.0.36. TDD-driven.

### Changed

- `detectEntities` path 1: the gate now reads `stereo === "entity" || stereo === "large-class"`. For `large-class`, an additional entity-shape filter (≥3 fields AND ≥3 method children) prevents oversized procedural modules from firing as domain entities. Confidence is 0.1 lower for the large-class path (base 0.6 vs 0.7) so consumers can rank pure entities above god-class entities. The kind-exclusivity precedence shipped in 0.6.0 (Fathom 5.0.32) ensures these surface as entity only, not double-counted as VOs.

### Why

Round-6 pilot F12: the workspace's largest BC cluster contains `graphlayerimpl` — a 936-LOC class with 12 fields and dozens of methods, the canonical "mutable state + behavior" entity shape. But `concepts_in_context` surfaces 8 VOs and 0 entities for that cluster. Root cause: the L1 stereotype rule cascade assigns `large-class` (rule 2) BEFORE the `entity` rule (rule 5), so structurally-entity-shaped classes that hit the methodCount > 20 OR loc > 500 thresholds get the anti-pattern stereotype and silently skip L7b entity emission. A class can be both a god-class AND an entity — the anti-pattern describes what it IS (oversized), the conceptKind describes what it MODELS (a domain object). The L6 god-class pattern + rating-side vetos continue to flag the anti-pattern separately; this change only adds the missing L7b emission.

### Tests

- 2 new regression tests: `large-class` with entity-shape (3 fields + 3 methods) fires as entity; `large-class` without entity-shape (1 field) does NOT fire.
- 37/37 tests pass.

## [0.6.0] — 2026-05-19

Bug fix — `recoverDomainModel` now enforces kind-exclusivity: an element classified as an entity is NOT also a value-object or a domain-service. Closes Fathom row 5.0.32. TDD-driven.

### Changed

- `recoverDomainModel` adds an entity-wins precedence pass after detection. Builds the set of `realizedByElementIds` across all detected entities; filters `detectValueObjects` and `detectDomainServices` output to drop concepts whose `realizedByElementIds` overlap the entity set. Aggregate-root and bounded-context are unaffected (aggregate-root shares its anchor entity by design; bounded-context is cluster-scoped and intentionally overlaps with per-element concepts).
- `rawCountsByKind` continues to report **raw** (pre-precedence) counts per kind, so consumers can observe how many VO/domain-service collisions were resolved.

### Why

Round-6 pilot F7: three elements (`node`, `codeelementref`, `patterninstance`) classified as BOTH entity AND value-object simultaneously. Root cause: a TS interface with ≥ 3 fields, 0 methods, AND ≥ 1 implementor qualifies as entity (path 2 — entity-shape) AND value-object (path 2 — pure shape) under the independent per-detector rules. Each detector's internal `seenIds` deduped within itself but didn't coordinate across detectors. Consumers querying by `conceptKind=entity` AND by `conceptKind=value-object` received the same elements twice — implementing the precedence client-side wasn't reasonable. DDD precedence: entity > value-object, entity > domain-service.

### Tests

- 1 new regression test in `recovery.test.ts` — pins the exclusivity invariant via a TS-interface fixture that fires both detectors pre-fix and asserts: (a) the element appears under exactly one concept post-fix; (b) the winning kind is `entity`; (c) no element appears under two `ConceptKinds` across the whole result (excluding `bounded-context` and `aggregate-root` per design).
- 35/35 tests pass.

## [0.5.1] — 2026-05-18

Patch — `isFixturePath` now consults `DomainElement.artifactId` (full file path) first, falling back to `id` when absent. `DomainElement` gains optional `artifactId` field. Closes a 5.0.26 (b) follow-up: in real runs, callers pass substrate UUIDs as `id` (not natural-keys), so the prior path-pattern check never matched. With `artifactId` populated by fathom-cli's runner, fixture-pathed elements are now correctly rejected.

### Changed

- `DomainElement.artifactId?: string` — source-file path; opt-in field.
- `isFixturePath(el: DomainElement)` (was `isFixturePath(elementId: string)`) — prefers `el.artifactId`, falls back to `el.id`. All call sites updated.
- 34/34 tests pass; existing fixture-path test still uses `id` form (the natural-key path embeds `/tests/`-style segments and the fallback still matches).

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
