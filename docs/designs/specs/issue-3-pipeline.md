# Issue 3: conversion pipeline, comparison report and private lab

## Frozen issue contract

From issue #3 and docs/PRD.md sections 4, 5 and 8:

1. A tool compares two independent transcriptions and lists differences element by element.
2. A document sets out the process: image reading by mutually blind fresh Claude instances, a second Kimi transcription of hand-drawn or printed charts, Kimi checking logic.
3. Lab content stays out of the public repo and can be bundled into one private page.
4. The letter motif goes through the real process, producing transcriptions and a difference report.
5. A photo produces a reconstruction draft with every number's source and error marked.

Invariants: `lab/` stays ignored; charts stay generated from data; a reconstruction is not a verified chart and stays private until someone has tatted it.

Non-goals: running AI from the website, automatic merging of transcriptions, web upload.

## Comparison tool

`node scripts/compare-transcriptions.mjs <a.json> <b.json>` reads two files holding `elements` (`id`, `type`, `parts`, optional `flip`). Placement is ignored, since readers don't draw.

It compares by working order. Each element reports: missing from one side, differing type, differing parts or flip. Parts are compared after parsing, so stitch counts, picot kinds and join targets count, while source marks are reported separately and don't count as a disagreement in the numbers. It prints a Chinese report and a final count, and exits 0 only when the numbers match. Malformed input exits 2 with the reason.

Picot names are private to each reader, so joins compare by target element and ordinal among that element's left picots, not by name.

Logic lives in `js/compare.js`, so it can be tested.

## Private lab

`node scripts/build-lab.mjs` writes `lab/dist/index.html`: one self-contained page, with CSS, code and every `lab/*.json` inlined. It uses the same page code as the site. `js/app.js` reads patterns from `window.TATTING_PATTERNS` when present, and fetches otherwise. Photos inline as data URIs when a pattern names a lab photo.

The page is published as a private artifact, so the founder can open it on a phone. Nothing from `lab/` reaches the public repo; a test confirms `lab/` is ignored and untracked.

## Process document

`docs/conversion.md` gives two flows, chart and photo, and states what passing does and doesn't show. A tier rises to `checked` only after an independent reader agrees and differences are settled, recording who in `reviewedBy`.

## Test plan

Comparison: identical files match; a changed count, a missing element, a differing type, a changed join target, a reordered element, a flip difference; renamed picots still match; source marks alone don't count; malformed input exits 2. Bundler: output contains the patterns, has no fetches of local files in effect, and loads headless in a browser. Repo test: `git check-ignore lab/x.json` holds and `git ls-files lab` is empty.
