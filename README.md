# Fast Site — site-generator-speed-01-run-20261122

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/luthfi130502/site-generator-speed-01-run-20261122/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/luthfi130502/site-generator-speed-01-run-20261122/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A faster drop-in for makefun-site 1.0.0: builds the same static site, byte
for byte, in less CPU time.

## How it works

- Templates are compiled once per case into plain JavaScript functions
  (no per-node interpreter walk on every page render).
- Markdown is rendered in a single pass; inline markup is parsed with
  chunked literal runs instead of per-character string building.
- Slugs are cached, link resolutions are memoised, and reading time is
  computed once per source.

## Layout

- `main.ts` — the harness driver (reads `/input/cases.json`, writes
  `/output/answers.json`).
- `solve.js` — the entry: `run(input)` returns the output tree.

## License

MIT. See [LICENSE](LICENSE).
