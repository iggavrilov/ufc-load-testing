# UFC Load Testing

k6 load-testing project for the UFC Pantheon multidev website:

https://develop.pantheon-multidev.ufc.com/

## Safety Warning

Run these tests only against approved staging or multidev environments. Do not run high-load tests without explicit approval from the UFC/Pantheon infrastructure owners.

This project currently includes only capped diagnostic profiles up to 100 VUs.

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
- open one discovered news/article page
- wait 1 to 5 seconds between actions

Each page is wrapped in a k6 `group()` and tracked with page-level duration metrics.

## Load Profiles

Profiles are controlled by `TEST_PROFILE`. The default is `smoke`.

| Profile | Peak VUs | Purpose |
| --- | ---: | --- |
| `smoke` | 10 | Quick validation and first diagnostics |
| `low` | 50 | Small approved load test |
| `medium` | 100 | Larger diagnostic test, capped at 100 VUs |

## Thresholds and Checks

The test fails if:

- HTTP error rate is 1% or higher
- overall p95 response time is 1500 ms or higher

Each request also checks:

- status is `200`
- response body is not empty
- response time is below `2000ms`

## Per-Page Metrics

The script records these custom Trend metrics:

- `homepage_duration`
- `events_duration`
- `athletes_duration`
- `news_duration`

`news_duration` includes both the `/news` listing request and the discovered news/article request.

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

## Basic Auth

The multidev site is protected by Basic Auth. Do not commit credentials to the repository.

For local runs, set credentials as environment variables:

```powershell
$env:BASIC_AUTH_USER = "ufc"
$env:BASIC_AUTH_PASSWORD = "<password>"
```

Basic Auth is sent as an HTTP `Authorization` header over HTTPS. The header value is Base64-encoded as required by Basic Auth; this is not encryption, so keep credentials in local environment variables or a secret manager.

## Run Commands

Smoke test:

```powershell
k6 run -e TEST_PROFILE=smoke tests/ufc-load-test.js
```

Low load:

```powershell
k6 run -e TEST_PROFILE=low tests/ufc-load-test.js
```

Medium load:

```powershell
k6 run -e TEST_PROFILE=medium tests/ufc-load-test.js
```

With Basic Auth:

```powershell
k6 run -e TEST_PROFILE=smoke -e BASIC_AUTH_USER=ufc -e BASIC_AUTH_PASSWORD=$env:BASIC_AUTH_PASSWORD tests/ufc-load-test.js
```

Override the base URL:

```powershell
k6 run -e BASE_URL=https://develop.pantheon-multidev.ufc.com -e TEST_PROFILE=smoke tests/ufc-load-test.js
```

You can also use npm script aliases if npm is available:

```powershell
npm run test:smoke
npm run test:low
npm run test:medium
```

## Results

Each run writes summary files to `results/`:

- `results/ufc-<profile>-summary.json`
- `results/ufc-<profile>-summary.csv`

The terminal summary highlights:

- profile
- total requests
- iterations
- error rate
- overall p95
- homepage p95
- events p95
- athletes p95
- news p95
- slowest page
- failed thresholds

The CSV includes both overall metrics and per-page metrics. Use the per-page p95 values to identify which page is driving an overall threshold failure.

You can also enable k6's detailed JSON event output:

```powershell
k6 run -e TEST_PROFILE=smoke --out json=results/ufc-smoke-details.json tests/ufc-load-test.js
```

Customize summary filenames:

```powershell
k6 run -e TEST_PROFILE=smoke -e OUTPUT_BASENAME=my-smoke-run tests/ufc-load-test.js
```
