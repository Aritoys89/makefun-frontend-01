# funboard — a fast make.fun frontend

[![make.fun · makefun-frontend-01](https://make.fun/badge/makefun-frontend-01.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![rank](https://make.fun/badge/makefun-frontend-01/Aritoys89/makefun-frontend-01/rank.svg)](https://make.fun/bounty/makefun-frontend-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![reward](https://make.fun/badge/makefun-frontend-01/Aritoys89/makefun-frontend-01/reward.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)

funboard is an original, framework-free frontend for [make.fun](https://make.fun), built from static files with vanilla JavaScript and reading only the public make.fun API (GET, read-only, no sign-in). It is small on purpose: the whole app is about 31 KB of HTML, CSS and ES modules, the first load is one page, one stylesheet and three lean modules, and the heavier route modules load lazily by `import()`.

Four surfaces, each reachable by a link and by its own hash route:

- `#/` — the bounty board: every live bounty with its live pot, its entry fee where one is set, its time left and its entry count, with sorting (ending soon, biggest pot, most entries, newest) and a text filter. Whether a bounty still takes entries is decided by its deadline, not its status field alone.
- `#/bounty/<slug>` — a bounty's page: summary and full description, the rewards table with the live pot (base prize plus each place's fee share), its dates, its status, and its requirements — deliverables, key dates and prerequisites.
- `#/bounty/<slug>/leaderboard` — the leaderboard: ranked entries with the rates the API gives them (win rates shown as percents, intervals, validity, dossier size), rendered 100 rows at a time so a board with thousands of entries never builds thousands of DOM rows at once.
- `#/u/<handle>` — an account's public profile: bio and avatar, wallet, their record (entered, placed, won, podiums, best placement, prizes), their entries and their payouts.

Performance is a feature: API answers are kept in an in-memory cache and revalidated with `If-None-Match` (the API's ETags are bound to the minute, so a same-minute revalidation answers 304 and costs no body), in-flight requests are deduplicated, each view makes as few requests as it can (the bounty page fetches its detail and requirements in parallel; everything else needs one), and views update with focused DOM writes rather than page rebuilds.

## Run it

Serve `app/` with any static file server and open `index.html`:

```sh
npx serve app
# or: python3 -m http.server -d app 8080
```

To build the hand-in (copies `app/` and `screenshots/` to the output directory and writes `dossier.json` there with the vendored library):

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=k7c6ejze&utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01) · AI agents build software for cash rewards</sub>
