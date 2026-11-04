# Issue 4: new interface: gallery, pattern page, working mode

## Frozen issue contract

From issue #4 and docs/PRD.md sections 1, 5 and 7:

1. Visuals follow PRD section 7. No green background.
2. Gallery: the chart and finished photo lead, and each card shows its trust tier.
3. Pattern page: the whole pattern at a glance; tapping a row of the stitch table highlights all matching elements on the chart.
4. Working mode: full screen, on the same chart the current element is solid and others faint, it moves by element, parts can be viewed within an element, flips are announced clearly, progress is saved.
5. Uncertainty and tier appear consistently on all three views.
6. Works on phone, tablet and desktop: one-handed on a phone, no horizontal scroll, light and dark.
7. Kimi reviews screenshots from a user's point of view.

Invariants: charts stay generated from data; the public site holds only original or public-domain patterns; a pattern that can't be drawn shows what is wrong, never takes the site down.

Non-goals: accounts, uploads, search, crochet and knitting, the lab tools (issue 3).

## Replacing the 81-step page

The old page advances a step per picot. That page goes. Understanding and doing now have separate views, so a person can see the whole, then work element by element.

## Routes

- `#/`: gallery.
- `#/p/<id>`: pattern page.
- `#/p/<id>/work`: working mode.

## Gallery

A single column of large plates on a phone, two or three on larger screens. Each plate has the chart on paper with a numbered caption (`图版 01`), the finished photo set as a small inset at the corner when there is one, the title, craft and difficulty, and the tier. A pattern that can't be drawn stays out, as today.

## Pattern page

- Header: title, tier stamp, and one plain sentence saying what that tier means, for example 已整理: 从图解转录，还没有人独立复核.
- Chart, full width on a phone, left column on larger screens, with numbers off by default.
- Summary: `5 环 · 0 桥 · 每环 22 针`, computed from data.
- Stitch table, split into rings and bridges, using the founder's own notation: `2,4,3,4○2`, where the comma is a join picot and `○` a decorative picot. Each row names its letters and total. Each row is a button; pressing it highlights those elements on the chart and shows their numbers, pressing again clears it.
- A legend for the marks actually used in this pattern, including uncertainty marks only if present.
- 还不确定的地方: the `toConfirm` list, when present, stated plainly.
- 自动核对, collapsed by default, with a sentence that passing shows the numbers agree, not that they are right.
- Finished photo.
- Primary action: 开始编, or 继续编 · 第 N 个 when progress is saved.

## Working mode

Full-height layout: chart above, a panel below on phones; side by side on larger screens. `current` is the element; finished ones stay full strength; others are faint.

The panel shows:

- Position: `第 3 个，共 16 个`, a progress bar, and the tier stamp.
- Flip, when the element has `flip.value: true`: a prominent line, 先翻面, or 先翻面（推测）when not from the source.
- Element: `C 环` or `D 桥`, and total stitches.
- The formula as large tappable parts. Tapping a part marks it on the chart with `reached` and `currentItem`. Each part reads in words beneath, for example 接到 A 环. Uncertain parts carry `?` or `≈` in the formula too.
- For the last element's end, 收尾 and the finish text, after pressing next.
- Previous and next, at the bottom of the screen, with next taking most of the width, within thumb reach on a phone. Arrow keys work.
- Exit back to the pattern page.

Progress is element index and part, stored per pattern and read safely, as now. A saved index outside the pattern's range is ignored.

## Visual system

Tokens from PRD section 7: linen page `#F7F4EC`, ink `#23262B`, madder `#A63A2E` used only for the current position and for uncertainty. Chart paper is warm white with a fine double rule, like a printed plate. Confirmed joins become ink rather than red, since madder is reserved. Dark mode has a warm charcoal page and dark paper with light ink; the chart reads through the same variables, so it stays correct there. Headings use the system Song stack; body the system sans; numbers use old-style figures where the font has them. Motion is limited to fades and highlight transitions, and off under reduced motion.

Tier stamp: a small outlined label with a slight tilt, solid only for 已试编. 复原稿 is dashed and madder.

## Chart adjustment

The start label moves inward, away from the arrow and flip marks. `highlight` with `counts` covers the table selection.

## Data helpers in js/pattern.js

- `partsInWords(pattern, element)`: for each part, its notation text, words, source and index.
- `handFormula(element)`: the founder's notation, with `?` and `≈` on uncertain parts.
- `formulaGroups` keeps its grouping, now keyed on `handFormula` and carrying the type.
- `summarize(pattern)`: counts of rings and bridges and stitches per group.

`buildSteps` and `describeStep` go, since nothing uses them; their tests go too, replaced by tests of the new helpers.

## Tests

Node tests cover the helpers, including notation for the flower (`5,2○2○2○2○2○2,5`), uncertain marks, the words for every part kind, and summaries. View logic that decides progress (`clampProgress`) is a pure function and is tested. Browser checks at 360px, 768px and 1280px, light and dark, step the whole flow, assert no horizontal scroll, and take screenshots for Kimi.

## Revisions from design debate (D4-1 to D4-14)

- The current element's cord is always madder, even before any part is chosen, so she can find her place.
- Working mode shows a local view by default on patterns with more than 8 elements, cropped to the current element, its neighbours and its join targets, with a 看全图 toggle. `renderChart` takes `viewBox`, and `focusBox(pattern, ids)` computes it.
- The screen stays awake in working mode through the Wake Lock API where available, re-acquired on `visibilitychange`, released on leaving.
- Join words name the picot: 接到 A 环的第 2 个接耳. The target element also stays visible on the chart while that part is selected.
- On phones the pattern page's chart is sticky and capped at 46% of the screen height, so pressing a table row shows its highlight.
- Colour tokens split: `--mark-join` is ink, `--mark-unsure` and `--mark-current` are madder, and dark mode uses a lighter madder for contrast. Buttons use ink, not green. A passed check is ink; a failed one is madder.
- Stitch table rows key on type plus the plain formula, so uncertain marks can't split a row. A letter with an inferred part carries `?`. The summary reads `10 环 · 6 桥`, adding 每环 22 针 only with a single ring formula.
- The position line opens a list of letters for jumping.
- Progress uses a new key, `work:<id>`, holding index, part and finished. The finish panel offers 重新开始.
- 自动核对 opens by itself when a check fails.
- An inferred no-flip shows quietly as 不翻面（推测）.
- Rings show 编完拉紧成环 in the panel, replacing the old close step.
- Browser checks run on a scratch copy that also holds the private motif, which covers bridges and flips. The private file never enters the repo.
- `tests/fixtures/little-flower-v1.json` stays for the picot golden test; its step and group assertions go.
