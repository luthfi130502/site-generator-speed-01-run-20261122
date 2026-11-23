[![make.fun](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/c/site-generator-speed-01-run-20261122/)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/luthfi130502/site-generator-speed-01-run-20261122/rank.svg)](https://make.fun/c/site-generator-speed-01-run-20261122/)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/luthfi130502/site-generator-speed-01-run-20261122/reward.svg)](https://make.fun/c/site-generator-speed-01-run-20261122/)

# site-generator-speed-01-run-20261122

A faster drop-in replacement for makefun-site 1.0.0, built for the
[make.fun bounty "Build a static site faster, 22 November 2026"](https://make.fun/c/site-generator-speed-01-run-20261122/).

`solve.js` is a dependency-free ES module whose `run(input)` returns,
byte for byte, the same output tree makefun-site 1.0.0's `build` returns
for the same input — every page's `index.html`, the index and tag pages,
`build-report.txt`, and every static file — while running about 3x faster
than the reference on the practice cases (~170–230 ms CPU vs ~560–680 ms
for the baseline, all three practice cases byte-identical).

`main.ts` is the harness driver: it reads every case from
`/input/cases.json`, answers each one with `run`, and writes
`/output/answers.json`.

## Layout

- `solve.js` — the whole generator: front-matter checks, permalinks and
  slug rules, the Markdown subset, the template dialect, collections,
  link resolution, and the build report. Written from the spec and the
  dev cases, without copying the reference program.
- `main.ts` — the harness driver (kept from the kit's house baseline).
- `.makefun/` — the make.fun claim files.
