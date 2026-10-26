# Keel eval set

Measures whether Keel catches real problems without crying wolf.

## Layout

```
eval/fixtures/<case-id>/
  original.png        # the approved ad
  variant-1.png       # what Meta's AI served (or a realistic synthetic variant)
eval/cases.jsonl      # one line per case: {"id","variant","label":"ok"|"defect","codes":[...]}
```

Target: **40 labelled pairs** — ~25 defects across every code in `packages/core/src/defects.ts`, ~15 acceptable variants (crops, brightness, placement resizes) to measure false positives.

Sources for variants: Advantage+ previews on a test ad account, Muse Image edits that reproduce publicly reported failures, and clean variants. Never commit brand assets you don't have rights to (`eval/fixtures/private/` is git-ignored).

## Run

```bash
npm run eval            # screen tier only
npm run eval -- --full  # screen + SAM 3.1 + Muse Spark inspection
```

Reports precision, recall per tier and per defect code, latency and cost per variant.
