---
name: Survey finding
about: One finding from a survey run, or one step of a plan
title: ''
labels: ''
---

<!--
Label this `survey:<name>` (survey finding) or `plan:<name>` (plan step) —
see plans/CLAUDE.md. Search that label before filing: a re-run mostly
re-derives findings that are already open, and those get a comment with the
new evidence rather than a second issue.

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
