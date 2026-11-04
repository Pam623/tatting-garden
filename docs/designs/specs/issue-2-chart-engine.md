# Issue 2: chart engine for rings, bridges, flips and confidence

## Frozen issue contract

From issue #2 and docs/PRD.md sections 5, 6 and 7:

1. Renders any ring and bridge structure from pattern data, with positions written in the data, not auto-laid out.
2. Renders the flower and the letter motif (10 rings, 6 bridges) correctly.
3. Rings show the volume of the thread; join and decorative picots look different; letters mark the order; flips have a mark.
4. Inferred and estimated content is visibly distinct from confirmed content, not by colour alone.
5. Highlights any set of elements, and shows the current element solid with the others faint.
6. Tests cover geometry: each picot sits on its element's line, and stitch counts decide positions.

Invariants: charts stay generated from data; the current site keeps working (redesign is issue 4); public files hold no third-party patterns, so the letter motif does not enter the repo.

Item 2's letter motif lives in a gitignored `lab/letter-motif.json`, written as part of this issue from the founder's chart. Its tier is `sorted` and its uncertainty is limited to `?`. `npm test` validates and renders it when present and prints that it was skipped when absent. A screenshot of it at desktop and at 360px wide is a merge gate, inspected by the implementer and Kimi.

Non-goals: page redesign, automatic layout, the lab bundling tool (issue 3).

## Placement data

Each element gains a `place`, in chart units, and the pattern gains `layout.viewBox`.

```json
{ "id": "A", "type": "ring", "place": { "base": [80, -60], "tip": [-20, 10], "width": 118, "dir": "ccw" } }
{ "id": "B", "type": "bridge", "place": { "from": [80, -60], "to": [60, 80], "bulge": 30 } }
```

A ring is the v1 teardrop from `base` to `tip`, walked in `dir` (`cw` or `ccw`). `width` is its true maximum width in chart units, so the flower's rings become 91. Direction matters: the chart reading of the letter motif shows some rings run the opposite way, and stitch numbers must land where the source puts them.

A bridge is a quadratic curve from `from` to `to`; `bulge` is the signed offset of the control point from the midpoint, positive to the left of travel. Its outside is the bulge side, or the left at `bulge: 0`. Picots and numbers go outside; its letter goes on the opposite side.

The structure check replaces its `startAngle` test: a pattern needs `layout.viewBox` of four numbers, and every element needs a valid place, so `structureProblems` stays honest about whether a pattern can be drawn. The structure check also requires each element to have a positive stitch total, so drawing never divides by zero. `checkStitches` stays as it is, so a zero segment still fails the check. `viewBox` width and height must be positive, `layout.closed` is optional and boolean. A ring needs `base`, `tip`, a positive `width` and `dir` of `cw` or `ccw`, with `base` and `tip` distinct. A bridge needs distinct `from` and `to` and a numeric `bulge`. A malformed place fails naming the element. `layout.type` and `startAngle` go. The flower's places are computed once from its v1 angles and written out as plain numbers.

## Engine

`js/diagram.js` is rewritten in place. It exports `renderChart(pattern, options)` returning an SVG string, and `elementGeometry(element)` returning `{ pointAt(fraction), length }` for tests and for the renderer.

Options:

- `current`: element id drawn solid, with elements not in `done` faint.
- `done`: ids drawn full strength, as finished.
- `reached`: stitches done on `current`, which colours that much of it.
- `currentItem`: index of the part in progress on `current`, which gets emphasis.
- `highlight`: ids to emphasise, others faint.
- `counts`: `'all'`, or a list of element ids that show numbers. Default none.
- `title`: accessible name, escaped by the engine; `app.js` stops escaping it.

Both `current` and `highlight` absent draws everything at full strength. `current` wins over `highlight`. Emphasis changes opacity and weight, never dashes, so an uncertain element stays dashed when current.

`elementGeometry` walks outward: `pointAt(0)` is the base, `pointAt(0.5)` the tip, `pointAt(1)` the base again. `pointAt` returns `{ x, y, out, along }`, the position with unit vectors for the outward side and the direction of travel; a bridge's `out` is its bulge side.

The first element keeps its start arrow, showing direction of travel.

## Look

- Thread: each element is drawn as a thick ink stroke with a thinner paper-coloured stroke on top, so it reads as a cord with two edges rather than a pen line.
- Stitches: a short tick across the cord at each stitch's centre, so picots fall between ticks. Ticks are left out, and the number carries the count, when an element's spacing is below 5 chart units at the 370-unit scale; that element then always shows its numbers, whatever `counts` says. An estimated segment has no ticks because the count is unknown.
- Marks scale with the viewBox: sizes are multiplied by `viewBox width / 370`, so a large motif does not shrink them.
- Decorative picot: small open loop outside the cord. Confirmed join picot: solid dot. A join draws a short solid link from the joining element to the picot it joins.
- Letter inside each ring; beside the midpoint of each bridge.
- Flip: with `value: true`, a small mark at the start of the element reading `翻`, or `翻?` and `翻≈` with a dashed outline when not from the source. With `value: false`, no mark, whatever its source; a stated guess of no flip is carried in `toConfirm`.
- Uncertainty, not by colour alone: inferred or estimated segments have a dashed cord and their number carries `?` or `≈`, with the error when known (`≈16±3`). An uncertain segment always shows its marked number, whatever `counts` says. Uncertain picots have a dashed outline and a small `?`; an uncertain join picot is a hollow diamond, so its shape differs from both a solid join dot and a round decorative picot, with a dashed link. The current `.joinline` dash rule in `style.css` is removed so confirmed links are solid, and a test pins it.

Colours are CSS variables set by the stylesheet, so the redesign can restyle without touching the engine.

## Live site

`js/app.js` moves to `renderChart`, using `current`, `done`, `reached`, `currentItem` and `counts`. The old step page keeps working. `style.css` gains classes for the new marks. The v1 snapshot's exact chart assertions are removed, since drawing changes on purpose; step text and table assertions stay. A golden test instead reads the 25 decorative picot centres from the v1 fixture and requires the migrated flower's to match within 1.5 units, in order, which pins each ring's direction.

## Test plan

- An element with an empty stitch count never draws NaN: pages only draw patterns that pass `structureProblems`, and a stitch-less element stays a structure failure.
- Geometry from independent values: ring `pointAt(0)` equals `base`, `pointAt(0.5)` equals `tip`, `ccw(f)` equals `cw(1-f)`; bridge `pointAt(0)` and `pointAt(1)` equal its ends, and `pointAt(0.5)` is `bulge / 2` from the chord midpoint. The ring's measured maximum width equals `width` within 1 unit.
- A picot after 5 of 22 stitches is rendered a fixed offset from `pointAt(5/22)`, parsed from the SVG output.
- Every class asserting uncertainty has a dash rule in `style.css`.
- On confirmed segments, tick count equals the stitch count; an estimated segment has none; an uncertain segment shows its marked number with `counts` unset; a dense element has no ticks and shows its numbers with `counts` unset.
- Dashed marks appear for `?` and `~` and not for confirmed parts.
- A flip renders its mark; no flip, no mark.
- A join's link connects the two picots' positions.
- `highlight` and `current` set classes on the right elements only.
- A synthetic public-safe fixture with 10 rings, 6 bridges and joins renders with every element and no NaN. The real letter motif is checked from the private lab, not in the public repo.
- `checkPattern` fails a missing or malformed place, naming the element.
- A new check, 桥两端接上了, compares only ring neighbours: a bridge's `from` must be within 1 unit of the previous element's base if that is a ring, and its `to` of the next element's base if that is a ring. With `layout.closed: true`, the list wraps from last to first. A bridge beside another bridge or an open end is not compared. It names the bridge.
