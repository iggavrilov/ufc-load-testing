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
- homepage p95 response time is 2500 ms or higher
- events p95 response time is 2500 ms or higher
- athletes p95 response time is 1500 ms or higher
- news p95 response time is 1500 ms or higher

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
- homepage timing phases: `blocked`, `connecting`, `tls_handshaking`, `sending`, `waiting`, `receiving`
- events timing phases: `blocked`, `connecting`, `tls_handshaking`, `sending`, `waiting`, `receiving`
- `homepage_response_size`
- `events_response_size`
- `athletes_response_size`
- `news_response_size`

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

Smoke test with timestamped result files:

```powershell
k6 run -e TEST_PROFILE=smoke -e OUTPUT_BASENAME=smoke-summary-YYYYMMDD-HHMMSS tests/ufc-load-test.js
```

Low load:

```powershell
k6 run -e TEST_PROFILE=low tests/ufc-load-test.js
```

Low load with timestamped result files:

```powershell
k6 run -e TEST_PROFILE=low -e OUTPUT_BASENAME=low-summary-YYYYMMDD-HHMMSS tests/ufc-load-test.js
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

Do not run `medium` or any high-load test without approval. Use `low` only after `smoke` has a `0` error rate, no authentication failures, no major 5xx errors, and acceptable p95 latency.

## Diagnostics

Use single-page mode to isolate one page repeatedly without increasing load:

```powershell
k6 run -e TEST_PROFILE=smoke -e TEST_MODE=single-page -e TEST_PAGE=homepage tests/ufc-load-test.js
k6 run -e TEST_PROFILE=smoke -e TEST_MODE=single-page -e TEST_PAGE=events tests/ufc-load-test.js
k6 run -e TEST_PROFILE=smoke -e TEST_MODE=single-page -e TEST_PAGE=athletes tests/ufc-load-test.js
k6 run -e TEST_PROFILE=smoke -e TEST_MODE=single-page -e TEST_PAGE=news tests/ufc-load-test.js
```

Supported `TEST_PAGE` values are `homepage`, `events`, `athletes`, and `news`.

Enable verbose diagnostics when you need request-level evidence:

```powershell
k6 run -e TEST_PROFILE=smoke -e TEST_MODE=single-page -e TEST_PAGE=homepage -e VERBOSE_DEBUG=true tests/ufc-load-test.js
```

When `VERBOSE_DEBUG=true`, slow requests, status codes, response sizes, timing breakdowns, redirect chains, and cache/CDN headers are printed. By default, slow means `2000ms` or more. Override it with `SLOW_REQUEST_MS`.

```powershell
k6 run -e TEST_PROFILE=smoke -e TEST_MODE=single-page -e TEST_PAGE=events -e VERBOSE_DEBUG=true -e SLOW_REQUEST_MS=1500 tests/ufc-load-test.js
```

To investigate cache issues, compare these signals:

- `X-Cache`, `X-Cache-Hits`, `X-Served-By`, `X-Timer`, `Age`, `Cache-Control`, and Pantheon `X-Styx-*` headers in verbose output.
- `cache_hit_count`, `cache_miss_count`, `cache_bypass_count`, and `cache_unknown_count` in the JSON/CSV summary.
- `waiting`/TTFB p95. High waiting time with MISS/BYPASS usually points to origin or cacheability issues.
- `receiving` p95 and response-size metrics. High receiving time with large payloads points to transfer size, compression, or frontend payload bloat.

## Cache Variant Diagnostics

Use `CACHE_VARIANT` to compare whether request headers are fragmenting cache or forcing origin rendering. Keep these runs on the `smoke` profile.

| Variant | Behavior |
| --- | --- |
| `default` | Current behavior. Sends Basic Auth when credentials are supplied and includes optional `COOKIE`/`REQUEST_COOKIE` and `X_CONSUMER_ID`/`CONSUMER_ID` values if you provide them. |
| `no_cookie` | Removes optional Cookie headers and clears the k6 cookie jar where supported. Basic Auth is preserved. |
| `no_consumer_id` | Removes optional `X-Consumer-ID`. Basic Auth and other current behavior are preserved. |
| `minimal_headers` | Sends only required request values, including Basic Auth when credentials are supplied. Optional Cookie and X-Consumer-ID values are not sent. |

Homepage cache-variant commands requested for operator follow-up:

```bash
TEST_MODE=single-page TEST_PAGE=homepage CACHE_VARIANT=default VERBOSE_DEBUG=true TEST_PROFILE=smoke k6 run tests/ufc-load-test.js
TEST_MODE=single-page TEST_PAGE=homepage CACHE_VARIANT=no_cookie VERBOSE_DEBUG=true TEST_PROFILE=smoke k6 run tests/ufc-load-test.js
TEST_MODE=single-page TEST_PAGE=homepage CACHE_VARIANT=no_consumer_id VERBOSE_DEBUG=true TEST_PROFILE=smoke k6 run tests/ufc-load-test.js
TEST_MODE=single-page TEST_PAGE=homepage CACHE_VARIANT=minimal_headers VERBOSE_DEBUG=true TEST_PROFILE=smoke k6 run tests/ufc-load-test.js
```

PowerShell examples with timestamped output names:

```powershell
k6 run -e TEST_MODE=single-page -e TEST_PAGE=homepage -e CACHE_VARIANT=default -e VERBOSE_DEBUG=true -e TEST_PROFILE=smoke -e OUTPUT_BASENAME=homepage-cache-default-YYYYMMDD-HHMMSS tests/ufc-load-test.js
k6 run -e TEST_MODE=single-page -e TEST_PAGE=homepage -e CACHE_VARIANT=no_cookie -e VERBOSE_DEBUG=true -e TEST_PROFILE=smoke -e OUTPUT_BASENAME=homepage-cache-no-cookie-YYYYMMDD-HHMMSS tests/ufc-load-test.js
k6 run -e TEST_MODE=single-page -e TEST_PAGE=homepage -e CACHE_VARIANT=no_consumer_id -e VERBOSE_DEBUG=true -e TEST_PROFILE=smoke -e OUTPUT_BASENAME=homepage-cache-no-consumer-id-YYYYMMDD-HHMMSS tests/ufc-load-test.js
k6 run -e TEST_MODE=single-page -e TEST_PAGE=homepage -e CACHE_VARIANT=minimal_headers -e VERBOSE_DEBUG=true -e TEST_PROFILE=smoke -e OUTPUT_BASENAME=homepage-cache-minimal-headers-YYYYMMDD-HHMMSS tests/ufc-load-test.js
```

How to interpret the cache results:

- `HIT` usually means the CDN/cache served the response without a full origin render.
- `MISS` means the cache did not have a reusable object for that request and likely contacted origin.
- `BYPASS` or `PASS` means cache rules intentionally skipped caching for the request.
- `UNKNOWN` means the response did not include enough recognized cache headers to classify it.
- `Age` increasing above `0` usually indicates a reusable cached response. Repeated `Age=0` with repeated MISS suggests cold cache, cache fragmentation, or bypass behavior.
- `X-Cache` and `X-Cache-Hits` show CDN/cache handling. Repeated `MISS` and `0` hit counts across variants point toward Basic Auth, multidev cache policy, or Drupal/Pantheon cache configuration.
- Compare `homepage_waiting p(95)` across variants. If TTFB drops when Cookie or X-Consumer-ID is removed, that header is likely affecting cacheability.

## Results

Each run writes summary files to `results/`:

- `results/ufc-<profile>-summary.json`
- `results/ufc-<profile>-summary.csv`

For comparison runs, use timestamped names:

- `results/smoke-summary-YYYYMMDD-HHMMSS.json`
- `results/smoke-summary-YYYYMMDD-HHMMSS.csv`
- `results/low-summary-YYYYMMDD-HHMMSS.json`
- `results/low-summary-YYYYMMDD-HHMMSS.csv`

The comparison report is saved at:

- `results/comparison-report.md`

The diagnostics report is saved at:

- `results/diagnostics-report.md`

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

Use `diagnostics-report.md` to identify why a page is slow:

- `Slowest timing phase` shows whether time is lost in connection setup, TLS, waiting/TTFB, or receiving the response.
- `Largest responses` points to payload-size issues.
- `Cache observations` highlights HIT/MISS/BYPASS patterns when CDN/cache headers are available.
- `Redirect observations` shows whether extra hops are adding avoidable latency.
- `Suspected bottleneck cause` combines the strongest signals into a likely next investigation path.

Read `comparison-report.md` from top to bottom:

- Start with the summary table to compare smoke and low metrics.
- Check `Failed thresholds` to see whether the run passed the configured gates.
- Check the per-page p95 columns to identify the slowest page.
- Use the recommendation section to decide whether to rerun smoke, investigate a bottleneck, or proceed to the next approved profile.

You can also enable k6's detailed JSON event output:

```powershell
k6 run -e TEST_PROFILE=smoke --out json=results/ufc-smoke-details.json tests/ufc-load-test.js
```

Customize summary filenames:

```powershell
k6 run -e TEST_PROFILE=smoke -e OUTPUT_BASENAME=my-smoke-run tests/ufc-load-test.js
```
