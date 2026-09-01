# DeFi Credit Market Dashboard - MVP

A static GitHub Pages dashboard for monthly lending fundamentals, with Governance available as a separate feed page.

## Fundamentals snapshot

`data/fundamentals.csv` is the durable monthly dataset. The frontend uses the most recent ISO date in the file and calculates the displayed take rate, ROIC, and economic profit:

```text
capital at risk = active loans * capital risk rate + capital risk adjustment
take rate = revenue / active loans
earnings margin = earnings / revenue
economic profit = earnings - token incentives - (15% * capital at risk)
```

The four cards above the cohort dashboard use `data/lending-venue-stats.csv`, which is generated from every DefiLlama venue tagged `Lending`, `NFT Lending`, `RWA Lending`, or `Uncollateralized Lending`. They are intentionally separate from the eight-venue cohort in `data/fundamentals.csv`. Market-wide `active_loans` is the current borrowed TVL, which keeps the total and market-share ranking on the same basis; the snapshot also stores each venue's active loans, revenue, and earnings 90 days earlier for KPI deltas. The cohort's `active_loans` remains its trailing 365-day average.

Economic profit (EP) shows where the real profit in lending sits. It is what a venue earns above its cost of capital, after subtracting the minimum profit that capital could have earned elsewhere:

```text
EP = earnings - token incentives - r * capital-at-risk
```

For the current snapshot, `r` is the 15% cost-of-capital hurdle.

Capital at risk is calculated as active loans multiplied by the capital risk rate, plus any capital risk adjustment. The default capital risk rate is 2.5%.

The committed August snapshot contains active loans, revenue, and earnings retrieved from public DefiLlama endpoints. `active_loans` is the trailing 365-day average of the protocol's borrowed TVL history. `revenue_ttm` is DefiLlama's `dailyFees` trailing-year total, while `earnings_ttm` is its `dailyRevenue` trailing-year total. `incentives_ttm` is a manually maintained TTM input; use `0` where a protocol has no incentive program.

The active-loan market-share chart uses `data/active-loan-market-share.csv`, which stores each protocol's historical borrowed TVL and its share of the total for that date. Run `npm run snapshot:market-share` to refresh it from DefiLlama.

`capital_risk_adjustment` captures pledged/slashable backstops that are not represented by loan-book risk. The starting values are $155M for Aave Umbrella and $39.3M for Spark Risk Capital; all other rows start at zero. Change these when the underlying capital changes.

### Monthly update workflow

1. Run `npm run snapshot:fundamentals -- 2026-09-30` to print eight current rows from the free DefiLlama endpoints.
2. Copy the eight data rows (not the repeated header) into `data/fundamentals.csv`; do not replace previous snapshots.
3. Paste the verified `incentives_ttm` numbers, using `0` for protocols without incentives, and revise capital-risk adjustments if needed.
4. Run `npm run snapshot:market-share` to refresh the historical borrowed-TVL table used by the active-loan market-share chart.
5. Run `npm run snapshot:lending-venues -- 2026-09-30` to refresh the all-venue KPI snapshot used by the cards.
6. Commit and deploy. The dashboard selects the newest snapshot automatically.

The fundamentals snapshot command only prints CSV and never overwrites your historical file. It defaults incentives to `0`, so replace those values for protocols with active incentive programs before publishing the snapshot. The all-venue snapshot writes `data/lending-venue-stats.csv`.

## Competitive scorecard

The protocol competitive scorecard compares the selected cohort protocol with the sector median for the active snapshot. The protocol selector uses the eight venues in `data/fundamentals.csv`; the timeframe controls borrowed-TVL growth and market-share deltas over 30D, 90D, or 1Y. Take rate is revenue divided by active loans, earnings margin is earnings divided by revenue, and incentive intensity is incentives divided by revenue. Period deltas for the economic metrics require an earlier dated row in `data/fundamentals.csv`.

## Product model

- **Separate Governance page.** The market dashboard lives at `index.html`; Governance lives at `governance.html` so feed browsing does not compete with market analysis.
- **Topic = feed row.** The original post contains the proposal/context and remains the canonical object; selecting a row opens a full-width detail view on the Governance page.
- **Latest post = activity signal.** A topic moves up the feed when `last_posted_at` changes.
- **Whitelist = original author.** A topic is admitted only when its OP is a whitelisted username or belongs to a whitelisted public Discourse group. An approved user merely commenting on someone else's topic does not admit it.
- **Detail view.** The selected topic shows its post contents, latest comment, metadata, and a link to the canonical forum post.
- **Protocol-normalized schema.** Adding another Discourse forum means adding one object to `config/protocols.json`.

## Why ingestion runs in GitHub Actions

The browser only requests local `data/governance.json`. The scheduled job talks to Discourse. This avoids depending on each forum's CORS settings, keeps optional API credentials out of the browser, and gives you one normalized data layer for Aave plus future protocols.

## Quick start

1. Create a new GitHub repository, e.g. `defi-governance-dashboard`.
2. Copy these files into the repo and push to `main`.
3. In **Settings → Pages**, set **Source** to **GitHub Actions**.
4. Open `config/protocols.json` and replace the starter Aave usernames with your actual whitelist.
5. Run the workflow manually once from **Actions**, or wait for the schedule.

The workflow runs every 15 minutes and redeploys the site with freshly generated JSON.

## Aave configuration

```json
{
  "id": "aave",
  "name": "Aave",
  "forum": "https://governance.aave.com",
  "latest_pages": 2,
  "whitelist": {
    "users": ["AaveLabs", "TokenLogic"],
    "groups": []
  }
}
```

`latest_pages: 2` scans roughly the first two pages of the forum's latest-topic list before filtering. Raise it if a whitelisted contributor can go quiet for long enough to fall further down the latest feed.

### Group whitelisting

If a Discourse group exposes its member list publicly, add its exact group slug/name:

```json
"whitelist": {
  "users": [],
  "groups": ["some-public-group"]
}
```

The ingestion script resolves `/groups/{name}/members.json` into usernames, then applies the same OP admission rule. Some forums hide groups; in that case use explicit usernames.

## Optional Discourse credentials

Public Discourse JSON routes often work anonymously, but forum operators can restrict or rate-limit them. The script supports GitHub Actions secrets without exposing credentials client-side:

- `DISCOURSE_API_KEY`
- `DISCOURSE_API_USERNAME`
- or protocol-specific versions such as `AAVE_DISCOURSE_API_KEY` and `AAVE_DISCOURSE_API_USERNAME`

For forums you do not administer, do not assume you can obtain an admin API key; public read endpoints should be your default integration path.

## Data schema

Each topic is normalized to fields including:

- `protocol`
- `topic_id`
- `url`
- `title`
- `topic_created_at`
- `last_activity_at`
- `original_poster`
- `latest_poster`
- `proposal_excerpt`
- `latest_comment_excerpt`
- `proposal_summary` (reserved for AI)
- `latest_comment_summary` (reserved for AI)

The frontend already prefers the summary fields when present, so an AI summarization stage can be added later without redesigning the UI.

## Adding another protocol

Append another object to `config/protocols.json`:

```json
{
  "id": "morpho",
  "name": "Morpho",
  "forum": "https://forum.example.com",
  "enabled": true,
  "latest_pages": 2,
  "whitelist": {
    "users": ["example-author"],
    "groups": []
  }
}
```

As long as the site is a standard Discourse instance, the same ingestion path should work. Protocol toggle buttons are created automatically from the config.

## Recommended next iterations

1. Replace the market-data placeholders with generated DefiLlama/CoinGecko JSON and chart rendering.
2. Add an AI stage that summarizes OP + latest reply after ingestion and caches the output by post ID.
3. Persist historical snapshots so you can chart governance activity and detect edits, new replies, and proposal status changes.
4. Add proposal lifecycle/status normalization (`TEMP CHECK`, `ARFC`, `AIP`, risk update, parameter change, etc.).
5. Add RSS/email/Telegram alerts only after the feed logic feels correct.

## Local preview

From the project directory:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` for the market dashboard or `http://localhost:8000/governance.html` for Governance.

The committed `data/governance.json` contains mock data so the UI renders before the first live ingestion run.
