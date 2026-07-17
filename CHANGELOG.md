# Changelog

All notable changes to `@kepello/nodegraph-domain-model`. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.23.0] — 2026-07-16

**Fathom row 3.1.8.4, disposition-layer §S7 wave 4 (domain-model slice) — the breaking wave.** The legacy per-kind membership edge family (`realizedBy`/`containsConcept`/`partOfContext`/`relatedTo` as raw edge TYPES, live alongside `analysis-disposition` edges since wave 3a) is RETIRED. `analysis-disposition` edges are now THE membership record. Public API signatures unchanged.

### Changed (breaking, pre-prod — delete `.fathom/graph.db` and re-analyze)

- `insertConcept` no longer emits `realizedBy`/`containsConcept`/`partOfContext`/`relatedTo`-typed edges. The `analysis-disposition` reconciliation (`reconcileDispositions`, live since wave 3a) is now the ONLY edge-hygiene path — its stale-target and stale-kind-set tombstoning also enforces `partOfContext`'s at-most-one invariant (previously a dedicated tombstone loop walking every existing `partOfContext`-typed edge; now implicit in the general (targetKey → kind-set) reconciliation, pinned by a new reassignment regression test).
- `realizedByEdges` / `containsConceptEdges` / `relatedToEdges` / `partOfContextEdge` re-implemented over `analysis-disposition` edges, filtering `metadata.kinds` CONTAINS the wanted kind — never the edge's `type` (shared across all kinds) or `subtype` (the primary kind only). A pair-overlap-merged edge (e.g. `containsConcept` + `relatedTo` on one target) now correctly surfaces through BOTH corresponding APIs, not just its primary kind's.
- `renameConcept` / `setEnrichment` (`supersedeWithMetadata`) capture-and-reemit ONLY the `analysis-disposition` family across the 5.0.39 metadata-only supersede — the four-way legacy capture (including the wave-3a `containsConcept` regression fix) is gone; its guarantee now lives entirely in the disposition-family capture.

### Removed

- **`REALIZED_BY_EDGE_TYPE` / `CONTAINS_CONCEPT_EDGE_TYPE` / `PART_OF_CONTEXT_EDGE_TYPE` / `RELATED_TO_EDGE_TYPE`** — dead with the emission they named. `REALIZED_BY_EDGE_TYPE` was imported by `fathom-mcp` (`src/phase-3/domain-model.ts`); that repo migrates off it in this same wave by a parallel mechanic (in-progress there: `domain-model-realized-by-disposition.test.ts`).
- `emitMembership` / `emitEdge` (private helpers) — no remaining callers once membership emission was retired.

### Tests

- New: `partOfContext AT-MOST-ONE — reassigning to a new context tombstones the old target's partOfContext kind` — pins that `reconcileDispositions`' general reconciliation (not a dedicated loop) preserves the invariant across a context REASSIGNMENT (not just a kind-set change on the same target).
- New: explicit read-API assertions on both pair-overlap pins (`overlay-dispositions.test.ts`) — the merged edge must appear in BOTH `containsConceptEdges`/`relatedToEdges` and `partOfContextEdge`/`relatedToEdges` respectively, guarding the "filter by `metadata.kinds`, never `subtype`" contract.
- Reworked (SANCTIONED deltas, not deletions): the wave-3a coexistence pin now asserts the legacy edge TYPES are ABSENT (was: present alongside dispositions); `overlay.test.ts`'s `partOfContext` edge-shape pin now asserts `type === ANALYSIS_DISPOSITION_EDGE_TYPE` + `subtype === "partOfContext"` (was: `type === PART_OF_CONTEXT_EDGE_TYPE`). `recovery.test.ts`'s kind-exclusivity pin (reads `realizedByElementIds` metadata, not edges) untouched, as expected.
- Suite: **124 pass** (was 123 pre-wave; net +1 new pin, 2 reworked). `npm run build` clean.

## [0.22.1] — 2026-07-16

Peer-floor sync, 3.1.8.4 wave 3a/3b sibling bumps — no code change. `@kepello/nodegraph-dispositions` peer floor `^0.1.0` → `^0.2.0` (0.x caret — did not admit the installed `0.2.0` without the bump).

### Tests

Suite unchanged: 123/123 pass. `npm run build` clean.

## [0.22.0] — 2026-07-16

**Fathom row 3.1.8.4, disposition-layer §S7 wave 3a (domain-model slice).** Two additive families: the overlay's insert path ALSO emits positive `analysis-disposition` edges (membership edges STAY — retirement is wave 4), and `recoverDomainModel` RETURNS named `refusals` (recording via `recordRefusal` is wave 3b).

### Added

- **Positive dispositions (overlay):** `insertConcept` emits one `analysis-disposition` edge per distinct target via `@kepello/nodegraph-dispositions`' `recordDispositions`, authored by THIS overlay's `domain-concept` mutator (the caller-mutator contract, substrate rule 5.0.42). Kinds map 1:1: `realizedBy`/`containsConcept`/`partOfContext`/`relatedTo`. Stale-edge hygiene mirrors membership's 5.1.5.1 fix AND adds stale-KIND reconciliation (a pair whose kind set changed re-emits fresh — `recordDispositions`' additive merge must not accumulate stale kinds across re-analyzes); identical re-inserts are churn-free (satisfied pairs skip the package's unconditional supersede). `renameConcept`/`setEnrichment` re-emit the disposition family through the metadata-only supersede (5.0.39 invariant, new family).
- **PAIR-OVERLAP RULING (task question):** a concept pair CAN carry two of {`containsConcept`, `partOfContext`, `relatedTo`} — at the API level only (`DomainConceptInput` admits a shared target across the three inputs). NO producer emits the shape today: fathom-cli's `insertConcept` call passes none of the three inputs, and no detector populates `containsConceptNames`/`relatedToConceptNames`. Handled + pinned anyway (the API is public): kinds merge onto ONE edge, `subtype` = primary kind per `PRIMARY_KIND_PRECEDENCE` (`containsConcept` ≺ `partOfContext` ≺ `relatedTo`), `metadata.kinds` carries all.
- **Refusal returns (recovery):** `RecoverDomainModelResult.refusals: {candidateRef, reason, detail}[]` over the frozen vocabulary, typed `Extract<RefusalReason, …>` against `@kepello/nodegraph-dispositions` (compile-breaks if the frozen enum drifts):
  - `below-confidence-threshold` — the composite minConfidence gate; detail `{score, threshold, conceptKind, name}`; `candidateRef` = first realizer (clusterId for bounded-contexts).
  - `kind-precedence-excluded` — the entity > value-object/domain-service filter; detail carries `excludedBy` + `overlappingElementIds`. (The domain-service arm is structurally unreachable today — role/kind-disjoint from every entity path — kept defensively.)
  - `no-entity-shape` — detector-internal NEAR-MISSES: `detectValueObjects` path-1's mutator-evidence gate (`cause: "mutator-method"`), `detectDomainServices`' statefulness (`cause: "too-many-fields"`) and no-behaviour (`cause: "no-methods"`) gates. Pre-claim: NOT part of `rawCountsByKind`; wave 3b adds them to IN and refused symmetrically.
- `RecoverDomainModelResult.mergedClaimCount` — raw claims collapsed by the 5.0.21.3 same-conceptId merge (EnvisionWeb measured 12). NOT refusals; required for wave 3b to close the L7b ledger: **Σ rawCountsByKind = concepts + mergedClaimCount + post-claim refusals** (pinned by test).
- Per-detector near-miss classification (doc'd on each detector): entities — NONE (path 1 has no post-admission shape gate; path 2's field floor is scan-population, its `!hasEntityShape` reject is a guaranteed VO handoff); aggregate-roots — NONE (singleton clusters definitional; zero-reference clusters are absence-of-evidence); bounded-contexts — NONE this wave (the `distinctiveness` threshold discard is near-miss-SHAPED but has no scoped frozen reason and fires at corpus scale; flagged for a later wave); value-objects — mutator gate; domain-services — both shape gates. Name-hygiene vetoes (fixture/helper/option-bag/adapter-cluster) stay expected non-selections this wave (the frozen `fixture` reason remains unwired at L7b).

### Changed (breaking)

- `detectValueObjects` / `detectDomainServices` return `DetectionResult {concepts, refusals}` instead of `ComputedConcept[]` (the other three detectors keep their array return — the asymmetry IS the classification). New exports: `DetectionResult`, `DomainModelRefusal`, `DomainModelRefusalReason`.
- New peer dependency: `@kepello/nodegraph-dispositions@^0.1.0`.

### Fixed

- **`supersedeWithMetadata` never captured `containsConcept` membership edges** — `renameConcept`/`setEnrichment` on a bounded-context silently stripped its containment membership (pre-existing; found extending the capture to the disposition family). Regression-pinned.

### Findings (not fixed here)

- **`too-few-fields` is unfireable at L7b:** frozen against pre-3.3.11 code — the class field/method recount it described moved owner-side into the `classRole` derivation; the remaining field floors gate the interface SCAN population (expected non-selections per the selector-denominator ruling). A frozen reason at a permanent 0% — wave-3b/measurement should confirm and the enum owner dispose.
- **`below-confidence-threshold` is dead at the DEFAULT threshold:** every detector's score floor is ≥ 0.6 (entity 0.6 · VO 0.6 · DS 0.65 · AR > 0.6 · BC ≥ 0.7), so at default minConfidence NOTHING can fail the composite gate (pinned). It fires only under operator-raised thresholds ⇒ the home corpus's measured 9-of-289 residual must decompose as kind-precedence-excluded + merged claims.

### Tests

- +19 (RED-first, all 19 failing pre-fix): 9 overlay-disposition pins (`overlay-dispositions.test.ts`, incl. both pair-overlap precedence pins, stale-target/stale-kind hygiene, churn-free idempotence, 5.0.39 re-emit ×2, the containsConcept regression), 5 recovery refusal pins (threshold detail, dead-gate floor pin, precedence, near-miss surfacing, claim conservation), 5 detector classification pins.
- Suite: **123 pass** (was 104). `npm run build` clean. End-to-end drive verified refusals + conservation + edge-family coexistence over a live in-memory substrate.

## [0.21.0] — 2026-07-14

Fathom row `overlay-projection-discards-14-of-19-facets` (3.1.0.7, the ROOT CAUSE of the naming-heuristic class `3.1.8.1`). `fathom-cli`'s abstractions runner hand-projected each L0 element down to `id`/`name`/`kind`/`language`/`artifactId` before calling `recoverDomainModel` — `baseTypes` (half the structural definition of a DDD value-object: "extends `System.Exception`" or similar) was invisible to every detector. Adds the field this row's shared facet bag lands on; **no detector reads it** — `recoverDomainModel` output is unchanged.

### Added

- `DomainElement.facets?: Readonly<Record<string, unknown>>` — the full L0 facet set (`@kepello/nodegraph-analysis`'s `projectElementFacets`), when the caller supplies it. Includes `annotations`/`baseTypes`/`isStatic`/`scalars`/`overridesExternalRoots` (a NEW fact from the same Fathom row: `overrides` edges to an external root, e.g. `System.Object.Equals`, previously dropped by every consumer entirely) — all previously invisible to every L7b detector. Plain structural type — no new peer-dependency. Optional, not required: making it required would force editing hundreds of hand-built `DomainElement` literals in `detectors.test.ts` for a field nothing reads yet.

### Tests

Suite unchanged: 103/103 pass. `npm run build` clean.

## [0.20.0] — 2026-07-14

**Row `identifier-derived-verdicts-claim-deterministic-authority` (Fathom `3.1.8.1`) — STEP (a) ONLY: PROVENANCE. Operator ruling 2026-07-14: "No naming convention may define code meaning."**

`ComputedConcept` / `DomainConceptMetadata` / `DomainConceptInput` gain a REQUIRED `evidenceProvenance: "structural" | "name" | "mixed"` field (mirrors `@kepello/nodegraph-analysis@3.61.0`'s `EvidenceProvenance`, same 3.1.8.1 row). **No detector behaviour changed** — same concepts, same confidence scores, only the provenance is new.

### Added

- `evidenceProvenance`, required, on `ComputedConcept` / `DomainConceptMetadata` / `DomainConceptInput`; persisted via `DomainModelOverlay.insertConcept` / read from `listConcepts()`. Schema `required[]` + `enumDescriptions` updated.
- `entity` / `value-object` / `domain-service` — always `"mixed"`. Every emission from every detector path runs through name-based rejection gates (`isFixturePath` / `isHelperModule` / `OPTION_BAG_SUFFIX_RE`; `detectDomainServices` has a FOURTH: the cluster-name `/(adapter|gateway|client)/i` skip) — a verdict that SURVIVED a name-based rejection gate is `"mixed"`, not `"structural"`: the name changed the outcome (it just happened not to reject THIS candidate).
- `bounded-context` — always `"name"`. The entire admission signal beyond raw cluster size is `distinctiveness`, computed by splitting member element NAMES into TF-IDF terms — delete that and NO bounded-context ever emits, for any cluster, regardless of size.
- `aggregate-root` — always `"structural"`. This detector's OWN root-selection logic (which entity in a cluster wins) reads only same-cluster entity-to-entity reference COUNTS, no identifier — a separate verdict from the entity concept it crowns, which carries its own `"mixed"` provenance independently.

### Tests

- `src/detectors-evidence-provenance.test.ts` (new, +7) — THE RATCHET: pins the constant provenance for every `ConceptKind`, both admission paths where a detector has two (`entity`/`value-object`'s classRole path + TS-interface-shaped path).
- Suite: **103 pass** (was 96 pre-row; +7 new). `npm run build` clean.

## [0.19.0] — 2026-07-11

**The three DDD detectors (`detectDomainServices`, `detectEntities`, `detectValueObjects`) migrate off raw stereotype matching onto `@kepello/nodegraph-analysis@3.60.0`'s `classRole`/`methodRole` engine-derivation contract** — the root fix for the `l7b-stereotype-vocabulary-drift` (3.3.11) class of bug: a consumer matching raw `classStereotype`/`methodStereotype` string values silently strands whenever the upstream vocabulary expands, because nothing fails loud on the miss. `classRole`/`methodRole` move the vocabulary→role mapping OWNER-side (compile-exhaustive tables in `nodegraph-analysis`); this package's admit-lists now read the stable role projection instead. Confidence-scoring formulas are unchanged (that was `overlay-confidence-honest-null-policy` 3.3.12, shipped in 0.18.0) — this is the vocabulary/admission fix only.

### Changed

- **`DomainContext`** (`context.ts`) gains `classRoles: ReadonlyMap<string, string>` and `methodRoles: ReadonlyMap<string, string>`, beside the existing `classStereotypes`/`methodStereotypes`. Plain-data maps (strings), same no-peer-dep shape as the existing stereotype maps — `fathom-cli` populates them from `nodegraph-analysis`'s `classRole`/`methodRole` derivations (integration wiring is out of scope for this repo-scoped row).
- **`detectDomainServices`**: admission gate is now `classRole ∈ {"service", "command-object"}` (was raw `classStereotype ∈ {"controller", "command"}`). All existing guards unchanged (fixture-path, helper-module, option-bag, adapter-cluster-name, `fields ≤ 2`, `≥ 1 method`).
- **`detectEntities`**: admission gate is now `classRole === "entity-candidate"` (was raw `classStereotype ∈ {"entity", "large-class"}`). The hand-rolled entity-shape recount that used to live in this detector (`fields.length>=3 && methods.length>=3`, counting every method-like child indiscriminately) is **deleted** — that gate now lives OWNER-side in `nodegraph-analysis`'s `classRole` derivation. The interface/type-alias path-2 logic (structural, not stereotype-keyed) is unchanged.
- **`detectValueObjects`**: admission gate is now `classRole === "data-holder"` (was raw `classStereotype === "data-class"`); the mutator-rejection gate is now child `methodRole === "mutator"` (was raw `methodStereotype === "mutator-shaped"`). The interface/type-alias path-2 (zero-method) logic is unchanged.

### Sanctioned deltas (recovered output changes, all deliberate)

1. **+domain-services.** `classRole "service"` also admits the `service-class` stereotype (every `*Service`/`*Server`/`*Impl`/`*Store` heuristic name-match) — this was **never** in the pre-migration raw admit-set (`{controller, command}` only). Domain-services go from 0 corpus-wide to > 0. This is the live drift the row was filed to close.
2. **Entity-gate tightening.** The owner-side `classRole` structural gate for `large-class` → `entity-candidate` (fields ≥ 3 AND non-accessor-non-constructor methods ≥ 3) is deliberately tighter than the deleted hand-rolled gate: it excludes constructors/destructors and syntactic accessors from the "behavior" method count, where the old hand gate counted every method-like child. A class with only a constructor + getters no longer qualifies as an entity even with ≥ 3 fields and ≥ 3 such children. "State + behavior" shouldn't count ctors/getters as behavior — the entity population may shrink at this margin; that's correct, not a regression.
3. **+VO rejections.** `methodRole` maps BOTH the heuristic `mutator-shaped` stereotype AND the S4 fact-confirmed `mutator` stereotype to the same `"mutator"` role. The pre-migration code matched the literal string `"mutator-shaped"` only, so a data-class with a fact-confirmed mutator was silently **admitted** as a value-object — that gap is now closed for free; value-objects with real mutators stop being admitted.

### Decisions

- **`classStereotypes` stays read (narrowly) inside `detectEntities`** — solely to pick the confidence-score bonus between the classic `entity` case (0.7) and the `large-class` secondary-match case (0.6); this is a scoring branch, not an admission gate, and confidence scoring is explicitly out of scope for this row. `methodStereotypes` has **zero remaining readers** in this package after the migration (was read only by the deleted `detectValueObjects` mutator check) — kept in `DomainContext` regardless, since it's still a live part of the public contract `fathom-cli` populates and other future consumers may read; removing it would be an unrelated, unrequested breaking-API change.
- **Persisted-overlay shape is unchanged** (`ComputedConcept` / `DomainConceptInput` fields are identical) but **recovered output changes** per the three sanctioned deltas above. **Flagged for the orchestrator**: `fathom-cli`'s abstractions phase needs to (a) wire `classRoles`/`methodRoles` into the `DomainContext` it builds from `nodegraph-analysis`'s `classRole`/`methodRole` derivations, and (b) bump `ABSTRACTIONS_CACHE_VERSION` — the persisted-overlay *shape* is unchanged but the *computed values* it caches are not, and a stale cache would silently serve pre-migration domain-service/entity/value-object counts. Both are out of scope for this repo-scoped fix.

### Tests

- `detectors.test.ts`: existing `detectEntities`/`detectValueObjects`/`detectDomainServices`/`detectAggregateRoots` fixtures (and the `recovery.test.ts`/isFixturePath-matrix fixtures that route through them) updated to supply `classRoles`/`methodRoles` alongside their existing `classStereotypes`/`methodStereotypes` entries, mirroring the real owner-side mapping — no assertion changes, contract-shape migration only; this also re-verifies the fixture-path / helper-module / option-bag / adapter-cluster guards fire correctly now that admission is `classRole`-driven rather than a stereotype-absence no-op. 5 new regression tests: (1) `detectEntities` admits on `classRole` alone with no `classStereotype` entry present; (2) `detectEntities` rejects a `large-class` whose raw field/method COUNTS would have passed the deleted hand gate but whose owner-side `classRole` is `"other"` (the entity-gate-tightening sanctioned delta, concretely witnessed); (3) `detectValueObjects` rejects a data-holder with a fact-confirmed `mutator` (not `mutator-shaped`) child (the +VO-rejections sanctioned delta); (4) `detectDomainServices` admits a `service-class`-stereotyped class via `classRole "service"` (the +domain-services sanctioned delta, the live drift fix); (5) `detectDomainServices` admits a `command`-stereotyped class via `classRole "command-object"` (guard-still-holds, both roles read). RED witnessed pre-migration: 4 of the 5 failed on the pre-migration code (tests 1, 2, 3, 4 above — nothing fired / old hand gate wrongly admitted / silently admitted / nothing fired, respectively); test 5 was already green pre-migration (raw `classStereotype === "command"` already matched) and serves as a guard-still-holds confirmation, not a RED regression. All GREEN post-fix, 0 regressions elsewhere.
- 96/96 pass (was 91, +5 new).

## [0.18.0] — 2026-07-11

**L7b (domain-model) confidence-saturation fixes** (`overlay-confidence-honest-null-policy` 3.3.12) — the L6/L7b member of the class the L3 fix (`@kepello/nodegraph-clusters@0.14.0`, `l3-confidence-honest-null-for-edgeless-clusters`) opened. Three sites, all in `detectors.ts`; none of them turned out to be a genuine no-evidence case (L3's `number | null` shape), so all three land on the class's other named shape — **observable-support**: a persisted field that makes a saturated/capped `confidenceScore` legible instead of an opaque mass point. Stereotype-matching admit sets (`detectDomainServices` / `detectValueObjects`) are untouched — that's the separate GATED `l7b-stereotype-vocabulary-drift` (3.3.11).

### Fixed

- **`detectBoundedContexts` (bounded-context) — dead `layerOk` gate deleted, not implemented.** The gate initialized `true` and was never set `false`; its documented purpose ("uniform layer assignment when L4 has run") was already structurally unimplementable — `DomainContext.layerByCluster` is one layer number PER CLUSTER, so there is no per-member data the check could ever compare against. Its constant `+0.1` was a signal-shaped no-signal contributing to every score. Deleted outright (implementing it for real would require widening `DomainContext` with per-element layer data — out of scope for a confidence-scoring fix); `layerByCluster` stays in the contract, documented as currently unconsumed, for that future work. **BREAKING**: the removed `+0.1` drops `confidenceScore`'s attainable ceiling from 1.0 to 0.9 for every bounded-context — 35/39 live bounded-contexts on the Fathom workspace measured at exactly 1.0 pre-fix. The redundant `Math.min(1, score)` clamp (now always a no-op — the formula can no longer reach 1) is removed too.
- **`detectBoundedContexts` — the distinctiveness term still saturates at distinctiveness ≥ 0.6** (`min(0.3, distinctiveness*0.5)`), so any cluster clearing that floor with ≥5 members still lands on the same 0.9 — a real ceiling, not a bug (the class contract's "make the ceiling observable" clause, not "eliminate the ceiling"). `ComputedConcept.distinctiveness` / `DomainConceptMetadata.distinctiveness` / `DomainConceptInput.distinctiveness` (new, optional, `bounded-context`-only): the raw unclamped ratio, persisted alongside `confidenceScore` so two clusters saturating identically stay distinguishable by their real evidence.
- **`detectAggregateRoots` (aggregate-root) — support-unweighted dominance.** `dominance = best.count / totalRefs` forces `dominance === 1.0` whenever `totalRefs === 1` (a single same-cluster entity-to-entity reference, anywhere) exactly the same as a cluster backed by dozens of references — the single live aggregate-root on the Fathom workspace sits at exactly the resulting 0.9-capped score. `ComputedConcept.dominanceSupport` / `DomainConceptMetadata.dominanceSupport` / `DomainConceptInput.dominanceSupport` (new, optional, `aggregate-root`-only): `totalRefs`, persisted alongside `confidenceScore` so a 0.9-from-1-edge read is distinguishable from a 0.9-from-many read. The numeric formula is unchanged (deliberately — see Decisions below); this is a support-aware field, not a score reweight.
- `recoverDomainModel`'s same-conceptId merge (5.0.21.3) now carries `distinctiveness` / `dominanceSupport` through collisions (max of the two halves, same shape as the existing `confidenceScore` max) — a merge must never silently lose evidence.

### Decisions

- **Observable-support over null, for all three sites.** None of the three sites is a genuine no-evidence case in L3's sense: `detectBoundedContexts` only reaches the scoring block after clearing real distinctiveness/vocabulary/size gates, and `detectAggregateRoots` only fires when `best.count > 0` (a real, if single, reference) — `totalRefs === 1` is *weak* evidence, not *absent* evidence. Nulling either score would suppress a legitimately-detected concept rather than make its confidence legible, which is exactly the "no silent degradation" clause-4 distinction (absent data ≠ missing capability) applied to a detection result that IS present, just thinly evidenced.
- **Support-aware via a persisted field, not a formula reweight, for the aggregate-root site.** The design offered "weight by support OR persist a support field" as equally valid. A field is non-breaking to the existing `confidenceScore` numeric contract (no risk of shifting which concepts clear `domainModel.minConfidence` downstream) and keeps the fix consistent in shape with the bounded-context site.
- **No `DOMAIN_CONCEPT_SCHEMA_VERSION` bump.** Both new fields are additive/optional, mirroring `@kepello/nodegraph-clusters@0.14.0`'s precedent (that release widened an existing *required* field to nullable — a larger shape change than two new optional fields here — without bumping its own `CLUSTER_SCHEMA_VERSION`). **Flagged for the orchestrator**: `fathom-cli`'s abstractions phase (`analyze-abstractions.ts`) maps `ComputedConcept` → `DomainConceptInput` field-by-field and does not yet pass `distinctiveness` / `dominanceSupport` through — wiring that plus a bump to `ABSTRACTIONS_CACHE_VERSION` (persisted-overlay shape changed) is out of scope for this repo-scoped fix and left for the orchestrator's integration pass. Until that wiring lands, the new fields exist in this package's contract and are exercised by this package's own tests, but nothing persists them from a real `fathom analyze` run.

### Tests

- `detectors.test.ts`: 2 existing tests extended (the bounded-context "≥3 members + distinct vocabulary" fixture now pins `confidenceScore === 0.9` + `distinctiveness === 1`, was silently `1`; the aggregate-root "most inbound refs" fixture now pins `dominanceSupport === 2`) + 3 new regressions — bounded-context: two clusters (distinctiveness 0.6 vs 1.0) saturate at the identical `confidenceScore` 0.9 but stay distinguishable via `distinctiveness`; aggregate-root: single-edge dominance flags `dominanceSupport === 1`; a 5-edge cluster with identical `confidenceScore` 0.9 flags `dominanceSupport === 5` (the "0.9-from-1-edge distinguishable from 0.9-from-many" acceptance case). RED witnessed pre-fix: all 5 failed (`dominanceSupport`/`distinctiveness` undefined; bounded-context `confidenceScore` pinned at the old forced `1`).
- `overlay.test.ts`: 1 new round-trip regression — `insertConcept` persists both fields onto `node.metadata` when supplied. RED witnessed pre-fix (`buildMetadata` didn't carry either field through).
- 91/91 pass (was 87).

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
