# Issue 1: pattern data v2, rule checks and tests

## Frozen issue contract

Acceptance criteria (from issue #1 and docs/PRD.md sections 5 and 6):

1. A pattern file describes rings and bridges, join picots, decorative picots, flips, a source for each number, a trust tier and a rights record.
2. The beginner flower is migrated, with its unconfirmed points marked as inferred.
3. Checks cover: positive stitch counts; join picots paired and left before joined; equal stitch counts within a group; no estimated value at tier checked or above; public patterns carry rights.
4. `npm test` passes with no third-party dependencies.
5. A failed check names the element.

Invariants: charts stay generated from data; the live site keeps working after this issue (the redesign is issue 4); the public `patterns/` folder holds only original or public-domain work.

Non-goals: new chart geometry (issue 2), comparison tooling and the lab (issue 3), interface changes (issue 4).

## Format

```json
{
  "schema": 2,
  "id": "little-flower",
  "title": "入门小花",
  "craft": "梭编",
  "difficulty": "入门",
  "tier": "sorted",
  "rights": { "kind": "original", "note": "创始人自己设计" },
  "summary": "...",
  "photo": "assets/little-flower.jpg",
  "layout": { "type": "flower", "startAngle": -50 },
  "elements": [
    { "id": "A", "type": "ring", "group": "petal", "parts": ["5", "p:first", "2", "o", "2", "p:last", "5"] },
    { "id": "B", "type": "bridge", "group": "long", "flip": { "value": true, "source": "source" }, "parts": ["15"] }
  ],
  "finish": "...",
  "toConfirm": ["..."]
}
```

`reviewedBy` is a list of strings saying who reviewed what and when, for example `"Kimi 2026-11-04 第二次转录"`. The person or stage granting the tier adds the entry.

Private patterns must not go in `patterns/`; the public check failing them is deliberate, and their home arrives with the lab in issue 3.

Tier is one of `reconstruction`, `sorted`, `checked`, `made`. Rights kind is one of `original`, `public-domain`, `private`.

### Part tokens

| Token | Meaning |
|---|---|
| `5` | 5 stitches |
| `o` | decorative picot |
| `p:name` | leave a join picot called `name` |
| `j:A.name` | join to picot `name` of element A |

Any token may end in a source mark. No mark means written in the source. `?` means inferred, for example `5?` or `j:A.first?`. `~` means estimated from a photo. A stitch estimate may carry its error: `16~3` is 16 plus or minus 3; `16~` has no stated error.

Parsing returns `{ kind, source, ...}` where source is `source`, `inferred` or `estimated`, and `error` for estimates. An unknown token is a failed check naming the element, never a crash.

`flip` records whether the work is reversed before the element: `{ "value": true|false, "source": "source"|"inferred"|"estimated" }`. Absent means no statement. An estimated flip counts as an estimated value for the tier check.

`p:name+` leaves a picot that may take several joins, for example a centre picot. Picot names are unique within an element. `elements` is listed in working order, and a join targets a picot left earlier in that order, in an earlier element or earlier in the same element.

## Checks

`checkPattern(pattern, { public })` returns an array with one `{ ok, label, detail, elements }` per check below, where `elements` lists the ids at fault. A pattern-level failure has an empty `elements` and names the pattern in `detail`. A missing or empty `elements`, `tier` or `rights` is a failed structure check, not a crash.

- Structure: ids unique; type is ring or bridge; tier and rights kind valid; every token parses.
- Stitches: every stitch token is a positive integer; every element has at least one stitch.
- Joins: every join targets a picot left earlier in working order, whether by an earlier element or earlier in the same element; a `p:name` picot takes exactly one join and a `p:name+` picot at least one; an unused join picot fails, because it means a transcription error. Duplicate picot names within an element fail.
- Groups: elements sharing `group` have equal stitch totals, equal decorative picot counts, and equal counts of all picots where a join-in counts as one (`o` + `p:` + `j:`).
- Tier: only `reconstruction` may carry `~`, including on flips. `?` stays allowed below `made`: on the current site the flower's inferences appear through `toConfirm`, which the page keeps rendering until issue 4 draws marks on the chart. `checked` and `made` need a non-empty `reviewedBy` list. `made` fails while `toConfirm` is non-empty or any `?` remains, since tatting it settled those. `reconstruction` fails on any unmarked token, on any stitch estimate with no error, and on a flip whose source is `source`; an absent flip makes no claim and passes.
- Elements with no `group` skip the group check.
- Public: with `public: true`, rights kind must be `original` or `public-domain`, and tier must not be `reconstruction`. `scripts/check-patterns.mjs` scans every `patterns/*.json` except `index.json` and fails if a file is not listed in `index.json` or a listed file is missing. Checks run before anything else reads the pattern, so a bad token reports a failure rather than crashing.

Passing checks shows the numbers agree with each other, not that they are right.

## Flower migration

E's join to A is marked `j:A.first?`. Every element carries `flip: { value: false, source: inferred }`. Working order and finish have no markable field, so they stay in `toConfirm` only, and all four `toConfirm` entries stay. A test pins them.

## Compatibility

`js/pattern.js` is rewritten in place for v2. `js/app.js` and `js/diagram.js` read `elements` through the same module. Bridges are not drawn until issue 2; the only live pattern has none. The chart, step text and stitch table stay the same, which a snapshot test pins. The status badge and the wording of the automatic checks do change. The old `expect` field goes, since groups cover it. `status` becomes `tier`, and the flower moves from 已核对 to 已整理, because no second party has independently verified its chart yet; the old label overstated it.

## Files

| Path | Change | Reason |
|---|---|---|
| js/pattern.js | rewrite | v2 parsing and checks |
| js/app.js, js/diagram.js | edit | read v2; stitch table grouping moves to pattern.js as `formulaGroups`, keyed by the rendered formula string with one row per distinct formula, so tests can import it |
| patterns/little-flower.json | rewrite | migrate |
| scripts/check-patterns.mjs | edit | run checks with public true |
| tests/pattern.test.mjs | new | every check, pass and fail |
| package.json | new | `npm test`, type module, no dependencies |
| docs/PRD.md | new | product document |
| README.md | edit | new format |

`package.json` declares `engines.node >=22`. `npm test` runs `node --test "tests/*.test.mjs" && node scripts/check-patterns.mjs`, verified on Node 24.13.

## Risks

- A returning visitor with cached old code and fresh data could see the error page until the cache refreshes, within GitHub Pages' short cache lifetime. Accepted: one user, brief window.
- A too-strict join rule could reject a valid chart where a picot is left and never used. In that case it should be `o`, so the rule stands.
- Joins that do not land on a named picot, such as a chain closing at the base of a ring, and lock joins, are not represented yet. Deferred until a real pattern needs them; such a closure would be written in `toConfirm`.

## Test plan

Unit tests for every token form and every check in pass and fail form, asserting the named element. Migration test: the flower passes all checks, has 22 stitches per ring, 5 decorative picots per ring, tier `sorted`, E's join to A marked inferred, and flips stated as inferred no-flip. Snapshot test: step text, stitch table rows and chart output for the flower match the pre-migration output, captured to a fixture before the rewrite. Script test: an unlisted file in the patterns folder fails.
