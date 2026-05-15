# @kepello/nodegraph-domain-model

Domain model recovery for [`@kepello/nodegraph`](https://github.com/kepello/nodegraph-core). Seventh-b layer of the Layered Code Abstraction arc (L7b in [Fathom's roadmap](https://github.com/kepello/Fathom/blob/main/docs/code_abstraction.md#l7--use-cases-and-domain-model)).

Recovers a domain model from L1 stereotypes + L3 clusters + L4 layers + L0 reference edges. Each detected concept is one of: **entity**, **value object**, **aggregate root**, **domain service**, or **bounded context**. Operator-overrideable via config; treat outputs as candidates, not authoritative.

## Quick start

```ts
import { recoverDomainModel, makeDomainModelOverlay } from "@kepello/nodegraph-domain-model";

const overlay = makeDomainModelOverlay(graph);
const result = recoverDomainModel({
  context: {
    elements: [...],
    classStereotypes: new Map([...]),
    methodStereotypes: new Map([...]),
    childrenOf: new Map([...]),
    referencesEdges: [...],
    clusters: [...],
    clusterByElement: new Map([...]),
    layerByCluster: new Map([...]),
  },
});

for (const concept of result.concepts) {
  overlay.insertConcept(concept);
}
```

## Surface

- `recoverDomainModel({ context, options? })` — composite recovery runner. Invokes per-kind detectors, filters by confidence, returns ordered `ComputedConcept[]`.
- Per-kind detectors (`detectEntities`, `detectValueObjects`, `detectAggregateRoots`, `detectDomainServices`, `detectBoundedContexts`) — invokable individually for testing or custom pipelines.
- `computeConceptId(conceptKind, name, clusterId?)` — stable content-hash identity helper.
- `makeDomainModelOverlay(graph)` — registers the `"domain-concept"` domain + indexes; exposes write / read API.

## Detection heuristics

| Concept | Signals |
| --- | --- |
| **entity** | L1 class stereotype `entity`; mix of state + behavior methods |
| **value-object** | L1 class stereotype `data-class`; no `mutator-shaped` methods |
| **aggregate-root** | entity with most references-to-other-entities-in-same-cluster (1 per cluster, when ≥2 entities present) |
| **domain-service** | L1 class stereotype `controller` / `command`; no/few fields; in a non-adapter cluster |
| **bounded-context** | L3 cluster with ≥ 3 members; respects L4 layering (members share a layer when L4 available); distinctive identifier vocabulary |

## Trade-offs

- **L1 class stereotypes are coarse** in v1 — without Wirfs-Brock role-stereotypes (`l1b-role-stereotypes` 3.1.1.2, Parked), aggregate-root + domain-service detection lean on class-stereotype proxies.
- **No business rule extraction in v1** — Sneed-style BRE parked as Fathom `l7-business-rule-extraction` (3.1.8.2).
- **Context map relationships unlabeled** — `relatedTo` edges between bounded contexts are emitted, but DDD relationship typing (customer/supplier, conformist, anti-corruption layer) parked as `l7-context-map-relationships` (3.1.8.3).
- **No cross-language domain model in v1** — concepts stay per-language until workspace-level link records exist (`l7-cross-language-domain-model` 3.1.8.4).
- **Operator review config-based**, not interactive (parked `l7-operator-mcp-interactive` 3.1.8.1).
- **Detection is candidate-only**; treat outputs as proposals for operator review, not ground truth.
