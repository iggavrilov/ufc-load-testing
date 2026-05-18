# UFC Load Test Comparison Report

## Test Run

- Test date/time: 2026-05-18 10:05 Europe/Chisinau
- Environment URL: https://develop.pantheon-multidev.ufc.com/
- Authentication: Basic Auth used
- Medium profile: not run
- Low profile: not run because smoke p95 was materially above threshold

## Summary

| Profile | VUs | Total requests | Iterations | Error rate | Avg response time | Overall p95 | Homepage p95 | Events p95 | Athletes p95 | News p95 | Slowest page | Failed thresholds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| smoke | 10 | 282 | 47 | 0.00 | 1107.32ms | 2522.88ms | 3366.03ms | 3029.86ms | 1360.09ms | 1333.78ms | homepage | `http_req_duration: p(95)<1500` |
| low | 50 | not run | not run | not run | not run | not run | not run | not run | not run | not run | not run | not run |

## Performance Degradation

Smoke-to-low degradation could not be measured because the low profile was not run. The smoke run had no request errors and no authentication failures, but the p95 response time was `2522.88ms`, which is `1022.88ms` above the `1500ms` threshold. That is not a slight threshold miss, so escalating to the 50 VU low profile would not be a clean next step.

## Likely Bottleneck

The homepage is the likely bottleneck in this smoke run:

- Homepage p95: `3366.03ms`
- Events p95: `3029.86ms`
- Athletes p95: `1360.09ms`
- News p95: `1333.78ms`

Homepage is the slowest page and is much slower than athletes and news. Events is also materially above the threshold and should be reviewed alongside homepage.

## Recommendation

Do not run the low or medium profile yet. First investigate homepage and events latency under the smoke profile, then rerun smoke with the same authenticated setup. Proceed to low only after smoke has `0` error rate, no authentication failures, no major 5xx errors, and an overall p95 that is under or only slightly above the threshold.

## Result Files

- `results/smoke-summary-20260518-100313.json`
- `results/smoke-summary-20260518-100313.csv`
