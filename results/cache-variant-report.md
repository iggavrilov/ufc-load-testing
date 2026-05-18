# UFC Cache Variant Diagnostics Report

## Purpose

This report is prepared for the next smoke-only diagnostics pass. The goal is to compare whether Cookie, X-Consumer-ID, or broader request headers are fragmenting cache or forcing origin rendering for the homepage.

## Scope

- Target: https://develop.pantheon-multidev.ufc.com/
- Mode: `TEST_MODE=single-page`
- Page: `TEST_PAGE=homepage`
- Profile: `TEST_PROFILE=smoke`
- Load cap: smoke only, 10 peak VUs
- Authentication: Basic Auth remains enabled when credentials are supplied

## Commands for Operator

```bash
TEST_MODE=single-page TEST_PAGE=homepage CACHE_VARIANT=default VERBOSE_DEBUG=true TEST_PROFILE=smoke k6 run tests/ufc-load-test.js
TEST_MODE=single-page TEST_PAGE=homepage CACHE_VARIANT=no_cookie VERBOSE_DEBUG=true TEST_PROFILE=smoke k6 run tests/ufc-load-test.js
TEST_MODE=single-page TEST_PAGE=homepage CACHE_VARIANT=no_consumer_id VERBOSE_DEBUG=true TEST_PROFILE=smoke k6 run tests/ufc-load-test.js
TEST_MODE=single-page TEST_PAGE=homepage CACHE_VARIANT=minimal_headers VERBOSE_DEBUG=true TEST_PROFILE=smoke k6 run tests/ufc-load-test.js
```

PowerShell equivalent:

```powershell
k6 run -e TEST_MODE=single-page -e TEST_PAGE=homepage -e CACHE_VARIANT=default -e VERBOSE_DEBUG=true -e TEST_PROFILE=smoke -e OUTPUT_BASENAME=homepage-cache-default-YYYYMMDD-HHMMSS tests/ufc-load-test.js
k6 run -e TEST_MODE=single-page -e TEST_PAGE=homepage -e CACHE_VARIANT=no_cookie -e VERBOSE_DEBUG=true -e TEST_PROFILE=smoke -e OUTPUT_BASENAME=homepage-cache-no-cookie-YYYYMMDD-HHMMSS tests/ufc-load-test.js
k6 run -e TEST_MODE=single-page -e TEST_PAGE=homepage -e CACHE_VARIANT=no_consumer_id -e VERBOSE_DEBUG=true -e TEST_PROFILE=smoke -e OUTPUT_BASENAME=homepage-cache-no-consumer-id-YYYYMMDD-HHMMSS tests/ufc-load-test.js
k6 run -e TEST_MODE=single-page -e TEST_PAGE=homepage -e CACHE_VARIANT=minimal_headers -e VERBOSE_DEBUG=true -e TEST_PROFILE=smoke -e OUTPUT_BASENAME=homepage-cache-minimal-headers-YYYYMMDD-HHMMSS tests/ufc-load-test.js
```

## Comparison Table

| Variant | Page | p95 | Avg | TTFB p95 | Response size | HIT | MISS | BYPASS | UNKNOWN | Age behavior | Notes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| default | homepage | pending | pending | pending | pending | pending | pending | pending | pending | pending | Current request behavior with Basic Auth and any optional supplied headers. |
| no_cookie | homepage | pending | pending | pending | pending | pending | pending | pending | pending | pending | Suppresses request Cookie header and clears the k6 cookie jar where supported. |
| no_consumer_id | homepage | pending | pending | pending | pending | pending | pending | pending | pending | pending | Removes optional X-Consumer-ID while preserving Basic Auth. |
| minimal_headers | homepage | pending | pending | pending | pending | pending | pending | pending | pending | pending | Sends only required auth/header values needed for the request to work. |

## How to Fill This Report

After each run, copy values from the JSON/CSV summary:

- `homepage_duration p(95)` to p95
- `homepage_duration avg` to Avg
- `homepage_waiting p(95)` to TTFB p95
- `homepage_response_size avg` or `max` to Response size
- `cache_hit_count`, `cache_miss_count`, `cache_bypass_count`, `cache_unknown_count` to cache counts
- `Age`, `X-Cache`, `X-Cache-Hits`, and `Vary` from verbose terminal output to Age behavior and Notes

## Interpretation Guide

- If `no_cookie` improves HIT count or lowers TTFB, Cookie variation is likely fragmenting cache or forcing origin rendering.
- If `no_consumer_id` improves HIT count or lowers TTFB, X-Consumer-ID variation is likely fragmenting cache.
- If `minimal_headers` improves HIT count or lowers TTFB, one or more nonessential headers may be affecting cacheability.
- If every variant remains MISS with `Age=0`, Basic Auth, multidev rules, or Drupal/Pantheon cache configuration may be bypassing cache.
- If HIT count increases but p95 remains high, investigate backend work outside HTML cache, payload size, or downstream dependencies.

## Current Baseline Before Variant Runs

- Homepage p95: 1775.27ms
- Homepage avg: 1431.26ms
- Homepage waiting/TTFB p95: 1659.72ms
- Homepage response size: 187109 bytes
- Cache behavior: 214 MISS, 0 HIT, repeated `Age=0`, repeated `X-Cache-Hits=0,0,0`

## Recommendation

Run the four variants using the smoke profile only. Do not run low, medium, high, or target profiles until homepage cache behavior and TTFB are understood and the full journey smoke threshold is stable.
