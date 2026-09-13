---
name: Survey finding
about: One finding from a survey run, or one step of a plan
title: ''
labels: ''
---

<!--
Survey finding: attach this as a sub-issue of the run's parent issue (see
plans/CLAUDE.md and plans/surveys/README.md) — do not label it `survey:<name>`,
that label is retired. Label it instead with:
  - the survey's own Category tag(s) (`dry`, `srp`, `testing`, `security`, …)
  - the survey-type label matching the parent issue (`health`, `ui`,
    `performance`, `product`, `data-integrity`)
  - a model-tier label: exactly one of `haiku`, `sonnet`, `opus`, `opus-plan`
  - `decision-required`, if the finding hinges on a product decision only the
    maintainer can make
Plan step (not a survey finding)? Label it `plan:<name>` instead and skip the
above.

Search the parent issue's sub-issues (or the survey-type label) before filing:
a re-run mostly re-derives findings that are already open, and those get a
comment with the new evidence rather than a second issue.

Field definitions live in plans/surveys/README.md. The six below are shared by
every survey; add whatever else your survey states (Category, Impact,
Baseline measurement, Repro, Invariant violated, Gap, …).
-->

**Model tier: <Haiku 4.5 | Sonnet 5 | Opus 5 | Opus 5 plan-mode>.** <One line on why that tier — rate the fix, not confirming it.>

## Problem

<One sentence: what is wrong and why it matters.>

## Evidence

<At least one file path plus a short verbatim quote from it — copy-pasted, not
paraphrased, and grep-safe (a span that lives on one line). This gets
spot-checked.>

## Breadth

<Number of files affected, from an actual search you can name. Write "est."
if you estimated. Where the exposure is a condition rather than a file set
("every entry, whenever two tabs are open"), say that instead — but still name
the search, including a grep that returned zero where absence is the point.>

## Fix

<One sentence: the concrete change. If the survey measures something, say how
that measurement should read afterwards.>
