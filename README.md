# UFC Load Testing

k6 load-testing project for the UFC Pantheon multidev website:

https://develop.pantheon-multidev.ufc.com/

## Safety Warning

Run these tests only against approved staging or multidev environments. High-load execution can affect shared infrastructure and must be approved before use.

The `high` and `target` profiles are guarded by `APPROVED_HIGH_LOAD=true` so they cannot be started accidentally.

## Project Structure

```text
ufc-load-testing/
  tests/
    ufc-load-test.js
  config/
    environments.js
  results/
  package.json
  README.md
```

## User Journey

The k6 script simulates a realistic UFC website flow:

- open the homepage
- visit the events page
- visit the athletes page
- open the news listing
- open one news/article page
- wait 1 to 4 seconds between actions

## Load Profiles

Profiles are intentionally staged. Do not start directly with 60000 virtual users.

| Profile | Peak VUs | Purpose |
| --- | ---: | --- |
| `smoke` | 10 | Quick validation |
| `low` | 100 | Small approved load test |
| `medium` | 1000 | Larger staged validation |
| `high` | 10000 | Requires approval |
| `target` | 60000 | Requires approval |

## Thresholds

The test fails if:

- HTTP error rate is 1% or higher
- p95 response time is 1500 ms or higher

## Setup

Install k6:

```powershell
winget install k6.k6
```

Verify:

```powershell
k6 version
```

No npm dependencies are required.

## Run Commands

Smoke test:

```powershell
npm run test:smoke
```

Low load:

```powershell
npm run test:low
```

Medium load:

```powershell
npm run test:medium
```

High load, only after approval:

```powershell
k6 run -e LOAD_PROFILE=high -e APPROVED_HIGH_LOAD=true tests/ufc-load-test.js
```

Target load, only after approval:

```powershell
k6 run -e LOAD_PROFILE=target -e APPROVED_HIGH_LOAD=true tests/ufc-load-test.js
```

Override the base URL:

```powershell
k6 run -e BASE_URL=https://develop.pantheon-multidev.ufc.com -e LOAD_PROFILE=smoke tests/ufc-load-test.js
```

## JSON and CSV Results

Each run writes summary files to `results/`:

- `results/ufc-<profile>-summary.json`
- `results/ufc-<profile>-summary.csv`

You can also enable k6's detailed JSON event output:

```powershell
k6 run -e LOAD_PROFILE=smoke --out json=results/ufc-smoke-details.json tests/ufc-load-test.js
```

Customize summary filenames:

```powershell
k6 run -e LOAD_PROFILE=smoke -e OUTPUT_BASENAME=my-smoke-run tests/ufc-load-test.js
```
