# The Sports Data Desk

A hub of sports data stories and visualizations. Each concept is a small data
pipeline (Python, public data) feeding a static page (Astro + D3).

## Concepts

| Concept | Page | Pipeline |
|---|---|---|
| Does the NFL draft build winners? | `site/src/pages/draft/` | `pipeline/build_draft_concept.py` |
| Pitch velocity and winning (MLB) | `site/src/pages/velocity/` | `pipeline/build_velocity_concept.py` |

## Layout

```
pipeline/            Python scripts: download public data, write tidy JSON
site/                Astro site
  src/data/          JSON written by the pipeline (committed)
  src/charts/        D3 chart modules
  src/lib/           Shared helpers and derived statistics
  src/pages/         One folder per concept
```

## Refresh the data

```sh
pip install -r pipeline/requirements.txt
python pipeline/build_draft_concept.py             # 2016–2025 by default
python pipeline/build_draft_concept.py --last 2026 # add a season
python pipeline/build_velocity_concept.py          # 2016–2025 by default
```

Raw downloads are cached in `pipeline/.cache/` (git-ignored).

## Run the site

```sh
cd site
npm install
npm run dev      # http://localhost:4321/sports-data/
npm run build    # static output in site/dist/
```

Pushes to `main` deploy to GitHub Pages via `.github/workflows/deploy.yml`
(enable Pages with "GitHub Actions" as the source in the repo settings).

## Data sources

- [nflverse](https://github.com/nflverse/nflverse-data): snap counts (from Pro
  Football Reference), draft picks, rosters and game results. Free, no API key.
- [Baseball Savant](https://baseballsavant.mlb.com): Statcast pitch velocity and
  pitcher leaderboards (CSV export).
- [MLB Stats API](https://statsapi.mlb.com): standings, team names and
  postseason series.
