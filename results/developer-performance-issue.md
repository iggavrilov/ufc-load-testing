# Title

Homepage authenticated smoke traffic shows elevated p95 latency caused primarily by waiting/TTFB and repeated CDN cache MISS

## Environment

- Target: https://develop.pantheon-multidev.ufc.com/
- Environment type: Pantheon multidev
- Authentication: Basic Auth over HTTPS
- Test date/time: 2026-05-18 Europe/Chisinau

## Test Setup

- Tool: k6
- Profile: smoke only
- Peak VUs: 10
- Mode: single-page diagnostics and full journey smoke
- User behavior: homepage, events, athletes, news/article journey with random 1-5 second think time
- Thresholds:
  - `http_req_failed rate < 1%`
  - overall `http_req_duration p95 < 1500ms`
  - homepage `p95 < 2500ms`
  - events `p95 < 2500ms`
  - athletes `p95 < 1500ms`
  - news `p95 < 1500ms`

## Summary

Smoke diagnostics were stable from an error-rate perspective, but homepage latency remains the main blocker for scaling. The homepage p95 was 1775.27ms in single-page smoke, above the original 1500ms target. Timing breakdown shows waiting/TTFB dominates homepage latency, while connection setup and TLS are effectively not the driver after warm-up. All authenticated homepage requests observed in the run returned CDN/cache MISS behavior.

## Actual Result

- Homepage single-page smoke p95: 1775.27ms
- Homepage average response time: 1431.26ms
- Homepage waiting/TTFB p95: 1659.72ms
- Homepage response size: 187109 bytes
- Error rate: 0
- Cache behavior: repeated MISS, `Age=0`, `X-Cache-Hits=0,0,0`
- Full journey smoke previously completed successfully but failed the overall p95 target by about 19.56ms.

## Expected Result

- Homepage single-page smoke p95 should be consistently below 1500ms, or below an engineering-approved alternative target.
- Authenticated smoke traffic should either receive cache HITs where expected or have a documented reason why Basic Auth/multidev traffic is intentionally uncached.
- Waiting/TTFB should not dominate page latency enough to fail the full journey p95 threshold.
- Full journey smoke should pass configured thresholds with no increase in error rate.

## Evidence Table

| Page | Requests | Error rate | Avg response | p95 response | Waiting/TTFB p95 | Response size | Redirects | Cache behavior |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Homepage | 214 | 0 | 1431.26ms | 1775.27ms | 1659.72ms | 187109 bytes | 0 | 214 MISS, 0 HIT |
| Events | 220 | 0 | 1193.63ms | 1479.37ms | 1264.25ms | 319386 bytes | 0 | 220 MISS, 0 HIT |
| Athletes | 247 | 0 | 644.36ms | 874.12ms | n/a | 104488 bytes | 0 | 247 MISS, 0 HIT |
| News | 482 | 0 | 494.38ms overall, 729.77ms page avg | 891.30ms page p95 | n/a | 92832 bytes | 241 | 241 MISS, 0 HIT |

## Impact

- Homepage currently blocks confidence in scaling beyond smoke because it exceeds the 1500ms target under only 10 VUs.
- Repeated cache MISS behavior may cause authenticated smoke traffic to exercise origin/Drupal rendering more than intended.
- If the cache behavior persists at higher profiles, origin load could increase quickly even when functional errors remain at 0.

## Suspected Root Cause

Most likely mixed causes, led by backend waiting/TTFB associated with CDN/cache MISS behavior. The strongest signals are:

- Homepage latency is dominated by waiting/TTFB, not TLS, connecting, sending, or receiving.
- Authenticated requests repeatedly returned MISS with `Age=0`.
- Cache variation includes `Cookie` and `X-Consumer-ID`, which can fragment cache entries if those headers are present or varied by the platform.
- Events has the largest payload and elevated TTFB, but homepage is the clearer threshold blocker.

## Steps to Reproduce

1. Set Basic Auth credentials locally.
2. Run homepage single-page smoke diagnostics.
3. Enable verbose diagnostics to capture cache headers and timing phases.
4. Compare homepage against events, athletes, and news using the same smoke profile.
5. Review `results/diagnostics-report.md` and timestamped JSON/CSV summaries.

## k6 Commands Used

```powershell
k6 run -e TEST_MODE=single-page -e TEST_PAGE=homepage -e VERBOSE_DEBUG=true -e TEST_PROFILE=smoke -e OUTPUT_BASENAME=homepage-diagnostics-20260518-101844 tests/ufc-load-test.js
k6 run -e TEST_MODE=single-page -e TEST_PAGE=events -e VERBOSE_DEBUG=true -e TEST_PROFILE=smoke -e OUTPUT_BASENAME=events-diagnostics-20260518-101844 tests/ufc-load-test.js
k6 run -e TEST_MODE=single-page -e TEST_PAGE=athletes -e VERBOSE_DEBUG=true -e TEST_PROFILE=smoke -e OUTPUT_BASENAME=athletes-diagnostics-20260518-101844 tests/ufc-load-test.js
k6 run -e TEST_MODE=single-page -e TEST_PAGE=news -e VERBOSE_DEBUG=true -e TEST_PROFILE=smoke -e OUTPUT_BASENAME=news-diagnostics-20260518-101844 tests/ufc-load-test.js
```

Requested cache-variant commands for follow-up isolation:

```bash
TEST_MODE=single-page TEST_PAGE=homepage CACHE_VARIANT=default VERBOSE_DEBUG=true TEST_PROFILE=smoke k6 run tests/ufc-load-test.js
TEST_MODE=single-page TEST_PAGE=homepage CACHE_VARIANT=no_cookie VERBOSE_DEBUG=true TEST_PROFILE=smoke k6 run tests/ufc-load-test.js
TEST_MODE=single-page TEST_PAGE=homepage CACHE_VARIANT=no_consumer_id VERBOSE_DEBUG=true TEST_PROFILE=smoke k6 run tests/ufc-load-test.js
TEST_MODE=single-page TEST_PAGE=homepage CACHE_VARIANT=minimal_headers VERBOSE_DEBUG=true TEST_PROFILE=smoke k6 run tests/ufc-load-test.js
```

PowerShell equivalent:

```powershell
k6 run -e TEST_MODE=single-page -e TEST_PAGE=homepage -e CACHE_VARIANT=default -e VERBOSE_DEBUG=true -e TEST_PROFILE=smoke tests/ufc-load-test.js
k6 run -e TEST_MODE=single-page -e TEST_PAGE=homepage -e CACHE_VARIANT=no_cookie -e VERBOSE_DEBUG=true -e TEST_PROFILE=smoke tests/ufc-load-test.js
k6 run -e TEST_MODE=single-page -e TEST_PAGE=homepage -e CACHE_VARIANT=no_consumer_id -e VERBOSE_DEBUG=true -e TEST_PROFILE=smoke tests/ufc-load-test.js
k6 run -e TEST_MODE=single-page -e TEST_PAGE=homepage -e CACHE_VARIANT=minimal_headers -e VERBOSE_DEBUG=true -e TEST_PROFILE=smoke tests/ufc-load-test.js
```

## Headers/cache Observations

- `X-Cache`: repeated `MISS, MISS, MISS`
- `X-Cache-Hits`: repeated `0,0,0`
- `Age`: repeated `0`
- `Cache-Control`: `max-age=43200, public`
- `Vary`: includes `Accept-Encoding`, `x-zone-langcode`, `X-Consumer-ID`, and `Cookie`
- Redirects: not observed for homepage/events, so redirects do not explain homepage/events latency.

## Recommended Engineering Investigation

1. Confirm whether Basic Auth and/or Pantheon multidev traffic is expected to bypass CDN/object cache.
2. Check whether `Cookie` or `X-Consumer-ID` is present on smoke requests and whether either header fragments cache.
3. Review Pantheon/CDN cache rules for homepage and events, especially `Vary`, `Age`, `X-Cache`, `X-Cache-Hits`, and `X-Styx-*` behavior.
4. Profile Drupal render time for authenticated homepage requests that produce MISS.
5. Inspect homepage backend dependencies, blocks, personalization, cache contexts, and cache tags.
6. Compare cache-variant diagnostics using `CACHE_VARIANT` to isolate whether cookie or consumer-id variation changes HIT/MISS or TTFB.

## Acceptance Criteria

- Homepage single-page smoke p95 is consistently below 1500ms, or an agreed target is documented and met.
- Homepage no longer returns repeated MISS for every authenticated smoke request, or engineering confirms this is expected for Basic Auth/multidev.
- Homepage waiting/TTFB p95 is reduced significantly from the observed 1659.72ms baseline.
- Full journey smoke test passes without p95 threshold failure.
- Error rate remains below 1% with no authentication failures and no increase from the current 0 error-rate baseline.
