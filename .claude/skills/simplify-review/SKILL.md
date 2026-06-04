---
name: simplify-review
description: Diff-level structural simplification review. Push for the "code judo" move that deletes complexity rather than rearranging it. Use when reviewing a diff before commit, reviewing a PR before merge, "simplify this change", "review this for structural quality", "is there a cleaner shape for this diff", "did this PR make the code messier". NOT for security/perf/correctness (use code-review). NOT for shipped-code audits with no diff (use tech-debt).
---

# simplify-review

Diff-level pressure to simplify. Runs on a change, not on a whole codebase.

## When to fire

- Build agent, post-green, pre-commit: run on the staged diff.
- Reviewer, pre-merge: run on a branch, PR URL, or pasted diff.
- Never on shipped code with no diff. That's `tech-debt`.

## Input

A diff. Staged changes, a branch comparison, or a PR URL. If none provided, ask what to review.

## The four lenses

Apply each lens to the diff. Each has a trigger, a check, and a preferred fix.

### 1. File size + concern density

Trigger: a touched file holds multiple distinct UIs, multiple unrelated exports, or distinct "sections" separated by comment headers.

Check: count concerns. A page with four tab subcomponents inlined is four files pretending to be one.

Fix: extract sibling files. Hard ceiling at 1000 lines. Everyday rule: if a file does N distinct jobs, it wants N files.

### 2. Repeated inline operation

Trigger: the diff or the file it touches contains the same operation written 3+ times, often under different helper names.

Check: inline date math, inline parsing, inline currency formatting, inline string normalization. `Date.parse(x) >= now - N * 1000` and its relatives are the canonical tell.

Fix: extract a pure utility to `lib/`. Replace all call sites in the same PR. Do not leave half the duplication behind.

### 3. Missing shared model

Trigger: the same domain concept is defined twice with hand-duplicated predicates.

Check: parallel arrays of `{key, label, done, ...}` that drift if anyone edits one and forgets the other. A "checklist" defined once for a health score and again for a task list. A status enum re-declared in two places.

Fix: define the model once. Derive both consumers from it.

### 4. Boundary leak / wrong home

Trigger: a feature file exports a generic utility that sibling features import. Policy logic inline in a render component. A type defined in feature A re-exported through feature B.

Check: cross-feature imports. `import { dollarsToCents } from './ProductComposer'` is a leak — currency is generic, ProductComposer is a feature. Auth-redirect logic inline in a page is policy in the wrong layer.

Fix: move to canonical location. Generic utilities to `lib/`. Policy to middleware. Shared types to a neutral types file.

## Output

Prioritize by structural impact, not by file order. Cap at 5 findings. High conviction only. No nit flood.

```
# simplify-review: <branch or PR title>

## Verdict
Approve | Request changes

## Findings

### [Lens N] <one-line summary>
- Where: file:line, file:line
- What: what the diff does
- Why: why it makes the code harder to reason about
- Fix: the smallest move that deletes the complexity
- Code-judo move (if any): the restructure that makes whole branches disappear
```

## Approval bar

Request changes when any of these hold and the author has not justified them:

- A touched file now does N distinct jobs and decomposes cleanly into N files.
- The diff or its file contains the same inline operation 3+ times.
- The diff defines or extends a domain model whose predicates are duplicated elsewhere.
- The diff imports a generic utility from a feature file, or puts policy logic in a render component.
- A file crossed 1000 lines with no structural justification.

Approve when none of the above and no plausible code-judo move was missed.

## Tone

Direct. Demand simplification when you see it. Five findings max, ranked by structural impact. Useful phrasings:

- "this file already does four things. extract before adding a fifth."
- "the same date-window operation appears three times. lift to `lib/time.ts`."
- "this checklist is defined twice. drive both from one model."
- "generic helper imported from a sibling feature. move to `lib/`."

Do not:

- Approve because tests pass — tests don't measure structure.
- List cosmetic nits when structural findings exist.
- Suggest a refactor that moves complexity around without deleting any.

## Worked example

Vendor dashboard, `src/app/you/vendor/page.tsx` (575 lines).

```
# simplify-review: vendor-dashboard diff

## Verdict
Request changes

## Findings

### [Lens 1] page.tsx concatenates four UIs into one file
- Where: src/app/you/vendor/page.tsx (lines 100-575)
- What: VendorDashboardInner + OverviewTab + FollowersTab + ActivityTab + TopTasks all inlined.
- Why: four independent subcomponents share no state. Each is 80-150 lines and reads like its own file.
- Fix: split into src/app/you/vendor/{page,Overview,Followers,Activity,TopTasks}.tsx.

### [Lens 2] same date-window operation written three times
- Where: page.tsx:158 (count7), page.tsx:402 (within/count), page.tsx:175 (sparkData loop)
- What: "events in the last N hours/days" computed inline three different ways.
- Why: every tab reinvents the same time-window math. Drift risk on every edit.
- Fix: lib/time-windows.ts exporting daysAgo, lastNDays, bucketByDay, countInWindow. Replace all sites in this PR.

### [Lens 3] vendor health checklist defined twice
- Where: page.tsx:233 (computeHealth), page.tsx:481 (TopTasks tasks array)
- What: cover_photo / story-200 / markets / bulletin appear as two parallel arrays with hand-duplicated predicates.
- Why: edit one, forget the other, the dashboard and the task list disagree.
- Fix: define VENDOR_HEALTH_CHECKS once. Derive both computeHealth and TopTasks from it.

### [Lens 4] currency helper lives in a feature file
- Where: src/components/sell/ProductComposer.tsx exports dollarsToCents; ServiceComposer and GatheringComposer import it from there.
- What: a generic money utility lives in the product-listing feature.
- Why: any non-product feature touching prices now depends on the product composer.
- Fix: move dollarsToCents to src/lib/money.ts. Update three import sites.
```

## What this skill is not

- Not a security, performance, or correctness review. Use `code-review`.
- Not a once-a-quarter codebase audit. Use `tech-debt`.
- Not a style guide. Naming and formatting are not structural.
