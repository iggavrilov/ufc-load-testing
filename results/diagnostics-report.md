# UFC Diagnostics Report

## Executive Summary

- Test date/time: 2026-05-18 10:18-10:27 Europe/Chisinau
- Environment URL: https://develop.pantheon-multidev.ufc.com/
- Profile: `smoke`
- Mode: `single-page`
- Authentication: Basic Auth used
- Low profile: not run
- Medium profile: not run

The environment is functionally stable at smoke scale: all four single-page runs had `0` error rate and no observed authentication failures or 5xx failures. Scaling to `low` is not recommended yet because homepage still fails the global p95 gate and shows consistent cache MISS plus high waiting/TTFB.

The page blocking scaling is homepage. Engineering should investigate homepage cacheability and Drupal/origin render time first, then validate events.

## Full Comparison Table

| Page | VUs | Requests | Iterations | Error rate | Avg response | Page p95 | Response size | Redirects | Cache result | Slowest observed phase | Failed thresholds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| homepage | 10 | 214 | 214 | 0.00 | 1431.26ms | 1775.27ms | 187109 bytes | 0 | 214 MISS, 0 HIT | waiting/TTFB p95 1659.72ms | `http_req_duration: p(95)<1500` |
| events | 10 | 220 | 220 | 0.00 | 1193.63ms | 1479.37ms | 319386 bytes | 0 | 220 MISS, 0 HIT | waiting/TTFB p95 1264.25ms | none |
| athletes | 10 | 247 | 247 | 0.00 | 644.36ms | 874.12ms | 104488 bytes | 0 | 247 MISS, 0 HIT | not phase-instrumented; p95 under threshold | none |
| news | 10 | 482 | 241 | 0.00 | 729.77ms page p95 basis | 891.30ms | 92832 bytes | 241 | 241 MISS, 0 HIT | verbose samples show waiting/TTFB dominant | none |

Notes:

- News performs one redirect per iteration from `/news` to `/trending/all`, so it has about 2 HTTP requests per iteration.
- Athletes response size was measured with one authenticated direct request because this run occurred before response-size metrics were extended to athletes/news in the script. Future runs record it directly.
- News response size is from verbose diagnostic samples and is now tracked directly in future runs.

## Timing Phase Analysis

Homepage and events were the only pages with full phase metrics during these runs.

| Page | blocked p95 | connecting p95 | TLS p95 | sending p95 | waiting/TTFB p95 | receiving p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| homepage | 0.00ms | 0.00ms | 0.00ms | low/negligible | 1659.72ms | 155.09ms |
| events | 0.00ms | 0.00ms | 0.00ms | low/negligible | 1264.25ms | 271.85ms |

Waiting/TTFB dominates the slow pages. Connection setup and TLS are not the primary cause: p95 is effectively zero for blocked, connecting, and TLS because connections are reused and setup cost only appears in occasional max values.

Events has a larger payload than homepage and higher receiving p95, but receiving is still far smaller than waiting/TTFB. Payload size contributes some latency on events, but it is not the main bottleneck.

## Cache Analysis

All final responses observed by k6 were cache MISS:

- Homepage: `X-Cache=MISS, MISS, MISS`, `X-Cache-Hits=0, 0, 0`, `Age=0`
- Events: 220 MISS
- Athletes: 247 MISS
- News final page: 241 MISS

Verbose homepage samples showed:

- `Cache-Control=max-age=43200, public`
- `Age=0`
- `X-Cache=MISS, MISS, MISS`
- `X-Cache-Hits=0, 0, 0`
- `Vary=Accept-Encoding, x-zone-langcode, X-Consumer-ID, Cookie, Cookie`
- Pantheon `X-Styx-Req-Id` and `X-Pantheon-Styx-Hostname` present

The repeated MISS pattern strongly correlates with slower waiting/TTFB on homepage/events. The `Vary` headers include `Cookie` and `X-Consumer-ID`, which may fragment cache entries or force origin work depending on request/session behavior. Basic Auth itself may also affect edge caching behavior in this multidev environment.

## Response-Size Analysis

| Page | Response size | Relative impact |
| --- | ---: | --- |
| events | 319386 bytes | largest payload; receiving p95 271.85ms |
| homepage | 187109 bytes | medium payload; receiving p95 155.09ms |
| athletes | 104488 bytes | smaller payload; p95 874.12ms |
| news | 92832 bytes | smallest payload; p95 891.30ms |

Payload size does not explain the homepage bottleneck because homepage is slower than events while being smaller. Events payload size likely adds some transfer time, but the dominant phase remains TTFB.

## Redirect Analysis

- Homepage: no redirects observed.
- Events: no redirects observed.
- Athletes: no redirects observed in the k6 run.
- News: one redirect per iteration from `/news` to `/trending/all`.

Redirect overhead is not the cause of homepage/events latency. News redirects are consistent and should be cleaned up if possible, but news still stayed below threshold.

## Repeated Patterns

- Homepage slow samples around 2000-2238ms showed waiting/TTFB between roughly 1553ms and 2166ms.
- Those same homepage slow samples were cache MISS with `Age=0` and `X-Cache-Hits=0`.
- Events had the largest response, but remained just under the global p95 threshold in isolation.
- Athletes and news were consistently faster than homepage/events.
- News consistently redirected but remained under threshold.

## Most Likely Root Cause

Classification: **mixed causes**

Primary cause: **backend TTFB bottleneck associated with CDN/cache MISS behavior**.

Secondary likely cause: **uncached Drupal rendering or cache fragmentation** for homepage and events.

Lower-confidence contributing cause: **payload size** for events only.

Unlikely primary causes:

- Redirect overhead: homepage/events had no redirects.
- Network/TLS issue: connection and TLS p95 were effectively zero.
- Pure payload size: homepage is slower than smaller pages and slower than events in some journey runs despite being smaller than events.

Confidence level: **high** that TTFB/cache MISS is the main driver; **medium** that the underlying origin work is uncached Drupal rendering specifically, because headers point to repeated MISS and Pantheon/Styx origin involvement but do not expose Drupal render internals.

## Suspected Root Cause

Homepage and events appear to be repeatedly missing cache and waiting on origin/Pantheon/Drupal work. The strongest evidence is high waiting/TTFB p95, repeated `X-Cache=MISS, MISS, MISS`, `Age=0`, and low connection/TLS/receiving times relative to total duration.

## Prioritized Optimization Recommendations

1. Review homepage and events cacheability in Pantheon/CDN:
   - Confirm why `X-Cache=MISS, MISS, MISS` persists despite `Cache-Control=max-age=43200, public`.
   - Inspect the effect of `Vary: Cookie` and `Vary: X-Consumer-ID`.
   - Check whether Basic Auth/multidev protection bypasses or fragments edge cache.

2. Investigate Drupal/origin render time for homepage first:
   - Profile homepage render path, blocks, views, API calls, personalization, and cache contexts.
   - Check Drupal page cache/dynamic page cache status and whether cookies/auth prevent reuse.

3. Investigate events page payload and server work:
   - Events is the largest response and has higher receiving time.
   - Optimize only after confirming cache behavior, because TTFB still dominates.

4. Remove or avoid the `/news` redirect:
   - Use `/trending/all` directly in tests if that is the canonical URL.
   - This is not blocking scale, but it removes avoidable noise.

5. Rerun smoke single-page diagnostics after cache fixes:
   - Start with homepage.
   - Then events.
   - Only return to journey smoke after both pages show acceptable p95 and cache behavior.

## Recommended Next Step

Do not scale to low yet. Engineering should first investigate homepage cache MISS behavior and origin/Drupal render time. Once homepage p95 is consistently under threshold in single-page smoke diagnostics, rerun the full smoke journey and reassess.

## Output Files

- `results/homepage-diagnostics-20260518-101844.json`
- `results/homepage-diagnostics-20260518-101844.csv`
- `results/events-diagnostics-20260518-101844.json`
- `results/events-diagnostics-20260518-101844.csv`
- `results/athletes-diagnostics-20260518-101844.json`
- `results/athletes-diagnostics-20260518-101844.csv`
- `results/news-diagnostics-20260518-101844.json`
- `results/news-diagnostics-20260518-101844.csv`
