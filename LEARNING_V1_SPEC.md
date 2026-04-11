# Learning V1 Spec

## Objective

Define a practical, low-cost learning system that improves discovery quality from human moderation outcomes without requiring a heavy ML platform.

Learning V1 should:
- reduce false positives in `reviewQueue`,
- preserve recall for good candidates,
- adapt monthly from approve/reject outcomes,
- remain explainable and reversible.

## Current Implementation Mapping

- Discovery scheduler command: `npm run discover:monthly`
- Learning report command: `npm run learning:report -- --period=YYYY-MM [--city=<id>]`
- Discovery run logs are written to `discoveryRuns/{runId}`
- Learning outputs are written to `learningStats/{cityId}_{period}`
- Automation workflow: `.github/workflows/monthly-discovery-learning.yml`

---

## System Boundaries

### Inputs
- Discovery candidates from scheduled source ingestion.
- Human moderation outcomes (`approved`, `rejected`) from admin review.
- Optional reject reason metadata.

### Outputs
- Updated confidence penalties/boosts.
- Hard-skip policies for low-value patterns.
- Monthly learning report with rule-change recommendations.

### Non-goals (V1)
- Automatic publishing to catalogue.
- End-to-end supervised model training.
- External paid data source orchestration.

---

## Data Contracts

## 1) Discovery Runs
Collection: `discoveryRuns/{runId}`

Suggested fields:
- `runId` (string)
- `cityId` (string)
- `startedAt` (timestamp)
- `finishedAt` (timestamp)
- `status` (`success` | `failed` | `partial`)
- `sourceSet` (array, e.g. `["osm"]`)
- `fetchedCount` (number)
- `queuedCount` (number)
- `skippedReviewedQueue` (number)
- `skippedApproved` (number)
- `skippedMemoryHard` (number)
- `skippedMemorySoft` (number)
- `memoryPenaltiesApplied` (number)
- `elapsedMs` (number)
- `errorSummary` (string, optional)
- `version` (string, discovery ruleset hash/version)

## 2) Candidate Features Snapshot (optional but useful)
Collection: `discoveryCandidates/{candidateId}` (TTL or compact retention)

Suggested compact fields:
- `runId`, `cityId`, `source`
- `nameNorm`, `addressNorm`, `geoBucket`
- `ruleSignals` (array of strings, e.g. `["shop:books","vintage_signal"]`)
- `initialConfidence`, `finalConfidence`
- `queued` (boolean)

## 3) Moderation Outcome Labels
Source of truth:
- `reviewQueue` status transitions
- approved publish refs (`places`/`events`)

Optional normalized label collection:
`reviewLabels/{labelId}` for easier analytics.

Suggested fields:
- `cityId`, `kind`, `decision`
- `candidateFingerprint`
- `ruleSignals` (array)
- `source`
- `reviewedAt`
- `rejectReason` (optional enum/text)

## 4) Rule Quality Stats
Collection: `learningStats/{cityId}_{period}`

Suggested fields:
- `period` (e.g. `2026-03`)
- `cityId`
- `bySignal` map:
  - `queuedCount`
  - `approvedCount`
  - `rejectedCount`
  - `approvalRate`
- `policyDiff` (what changed this period)

---

## Feature/Signal Taxonomy

Use interpretable signals (string IDs), for example:
- source: `source:osm`
- core tags: `shop:second_hand`, `shop:books`, `amenity:recycling`
- keyword signals: `kw:vintage`, `kw:used_books`, `kw:refurbished`
- brand signal: `brand:humana`
- geo pattern: `name_geo_repeat`
- memory class: `memory:hard_match`, `memory:name_only`

Signals should be deterministic and cheap to compute.

---

## Decision Policy (V1)

## Hard Skip Rules
Immediate skip if:
- already reviewed queue item is final,
- approved place duplicate strong match,
- memory strong fingerprint/key match.

## Soft Penalty Rules
Candidate confidence reduced if:
- weak memory name/name+geo matches,
- historically poor-performing rule signals.

Candidate stays in queue unless confidence falls below threshold.

## Threshold Guards
Suggested defaults:
- `minQueueConfidence = 0.52`
- `softPenaltyCap = 0.24`
- never apply hard-skip from low-sample signals.

---

## Monthly Learning Job

## Frequency
- Monthly, after scheduled city discovery runs.

## Steps
1. Aggregate labels by city and signal for period.
2. Compute metrics:
   - approval rate,
   - support size,
   - trend vs prior period.
3. Generate policy recommendations.
4. Apply only guarded updates.
5. Write report + policy diff.

---

## Guardrails for Policy Updates

Only auto-apply if minimum support is met.

Suggested guardrails:
- `minSupportForAutoChange = 30`
- Hard-skip candidate signal only if:
  - support >= 50 and
  - approvalRate <= 0.05 across >= 2 periods.
- Boost signal only if:
  - support >= 30 and
  - approvalRate >= 0.75.

Everything else remains manual recommendation.

---

## Reject Reason Taxonomy (Recommended)

Use constrained reasons to improve actionability:
- `not_circular`
- `duplicate_existing`
- `wrong_city`
- `insufficient_evidence`
- `closed_or_invalid`
- `other`

Optional free-text notes can be retained separately.

---

## KPI Targets (Initial)

Track per city and globally:
- queue precision (approved / reviewed),
- duplicate skip effectiveness,
- false-positive burden (rejected / reviewed),
- moderation latency.

Initial targets (adjust over time):
- +10-20% precision improvement in 2-3 cycles,
- -20% avoidable duplicate reviews,
- stable queue volume (no uncontrolled growth).

---

## Cost Model (V1)

## Compute
- Low: aggregation jobs monthly + existing discovery scripts.

## Storage
- Moderate but controlled with compact docs and TTL for transient candidate snapshots.

## Human review
- Primary cost driver.
- Learning should optimize this first by reducing low-value candidates.

---

## Rollout Checklist

1. Add/verify run logging (`discoveryRuns`).
2. Ensure moderation writes include stable signals/fingerprints.
3. Add optional reject reason capture in admin workflow.
4. Implement monthly aggregation + recommendation job.
5. Enable guarded auto-policy updates for high-confidence patterns only.
6. Add dashboard/report for monthly review.

---

## Example Monthly Report (Template)

- Period: `YYYY-MM`
- Cities processed: `N`
- Candidates fetched: `X`
- Queued: `Y`
- Reviewed: `Z`
- Approval rate: `A%` (delta vs previous period)
- Top positive signals:
  - `signal_1`: support S, approval R%
  - `signal_2`: support S, approval R%
- Top negative signals:
  - `signal_3`: support S, approval R%
  - `signal_4`: support S, approval R%
- Proposed policy changes:
  - soft-penalize `signal_3` by `p`
  - boost `signal_1` by `b`
  - keep `signal_4` manual-review only (support below threshold)

---

## Future Extension Path

After 2-4 stable periods:
- add calibrated re-ranker (lightweight model),
- compare against rule baseline in shadow mode,
- keep human moderation as final gate until measurable reliability is proven.

