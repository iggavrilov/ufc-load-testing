import http from 'k6/http';
import { check, group, sleep } from 'k6';
import encoding from 'k6/encoding';
import { Counter, Trend } from 'k6/metrics';
import {
  defaultThresholds,
  environments,
  loadProfiles,
} from '../config/environments.js';

const ENVIRONMENT = __ENV.ENVIRONMENT || 'develop';
const TEST_PROFILE = __ENV.TEST_PROFILE || __ENV.LOAD_PROFILE || 'smoke';
const TEST_MODE = __ENV.TEST_MODE || 'journey';
const TEST_PAGE = __ENV.TEST_PAGE || 'homepage';
const OUTPUT_BASENAME = __ENV.OUTPUT_BASENAME || `ufc-${TEST_PROFILE}-summary`;
const BASE_URL = (__ENV.BASE_URL || environments[ENVIRONMENT]?.baseUrl || '').replace(/\/$/, '');
const PROFILE = loadProfiles[TEST_PROFILE];
const BASIC_AUTH_USER = __ENV.BASIC_AUTH_USER;
const BASIC_AUTH_PASSWORD = __ENV.BASIC_AUTH_PASSWORD;
const VERBOSE_DEBUG = __ENV.VERBOSE_DEBUG === 'true';
const SLOW_REQUEST_MS = Number(__ENV.SLOW_REQUEST_MS || 2000);
const MAX_REDIRECTS = Number(__ENV.MAX_REDIRECTS || 5);
const CACHE_VARIANT = __ENV.CACHE_VARIANT || 'default';
const OPTIONAL_COOKIE = __ENV.COOKIE || __ENV.REQUEST_COOKIE;
const OPTIONAL_CONSUMER_ID = __ENV.X_CONSUMER_ID || __ENV.CONSUMER_ID;
const SUPPORTED_CACHE_VARIANTS = ['default', 'no_cookie', 'no_consumer_id', 'minimal_headers'];

const homepageDuration = new Trend('homepage_duration', true);
const eventsDuration = new Trend('events_duration', true);
const athletesDuration = new Trend('athletes_duration', true);
const newsDuration = new Trend('news_duration', true);

const homepageBlocked = new Trend('homepage_blocked', true);
const homepageConnecting = new Trend('homepage_connecting', true);
const homepageTlsHandshaking = new Trend('homepage_tls_handshaking', true);
const homepageSending = new Trend('homepage_sending', true);
const homepageWaiting = new Trend('homepage_waiting', true);
const homepageReceiving = new Trend('homepage_receiving', true);
const homepageResponseSize = new Trend('homepage_response_size', false);

const eventsBlocked = new Trend('events_blocked', true);
const eventsConnecting = new Trend('events_connecting', true);
const eventsTlsHandshaking = new Trend('events_tls_handshaking', true);
const eventsSending = new Trend('events_sending', true);
const eventsWaiting = new Trend('events_waiting', true);
const eventsReceiving = new Trend('events_receiving', true);
const eventsResponseSize = new Trend('events_response_size', false);
const athletesResponseSize = new Trend('athletes_response_size', false);
const newsResponseSize = new Trend('news_response_size', false);

const redirectCount = new Counter('redirect_count');
const cacheHitCount = new Counter('cache_hit_count');
const cacheMissCount = new Counter('cache_miss_count');
const cacheBypassCount = new Counter('cache_bypass_count');
const cacheUnknownCount = new Counter('cache_unknown_count');

if (!BASE_URL) {
  throw new Error(`Unknown environment "${ENVIRONMENT}". Set ENVIRONMENT or BASE_URL.`);
}

if (!PROFILE) {
  throw new Error(`Unknown test profile "${TEST_PROFILE}". Use one of: ${Object.keys(loadProfiles).join(', ')}.`);
}

if (!SUPPORTED_CACHE_VARIANTS.includes(CACHE_VARIANT)) {
  throw new Error(`Unknown CACHE_VARIANT "${CACHE_VARIANT}". Use one of: ${SUPPORTED_CACHE_VARIANTS.join(', ')}.`);
}

export const options = {
  scenarios: {
    ufc_user_journey: PROFILE,
  },
  thresholds: defaultThresholds,
};

const phaseMetrics = {
  homepage: {
    blocked: homepageBlocked,
    connecting: homepageConnecting,
    tls_handshaking: homepageTlsHandshaking,
    sending: homepageSending,
    waiting: homepageWaiting,
    receiving: homepageReceiving,
    response_size: homepageResponseSize,
  },
  events: {
    blocked: eventsBlocked,
    connecting: eventsConnecting,
    tls_handshaking: eventsTlsHandshaking,
    sending: eventsSending,
    waiting: eventsWaiting,
    receiving: eventsReceiving,
    response_size: eventsResponseSize,
  },
};

const responseSizeMetrics = {
  homepage: homepageResponseSize,
  events: eventsResponseSize,
  athletes: athletesResponseSize,
  news: newsResponseSize,
  'news article': newsResponseSize,
};

const pages = {
  homepage: { name: 'homepage', path: '/', trend: homepageDuration },
  events: { name: 'events', path: '/events', trend: eventsDuration },
  athletes: { name: 'athletes', path: '/athletes', trend: athletesDuration },
  news: { name: 'news', path: '/news', trend: newsDuration },
};

function clearCookies(url) {
  try {
    const jar = http.cookieJar();

    if (jar && typeof jar.clear === 'function') {
      jar.clear(url);
    }
  } catch (error) {
    if (VERBOSE_DEBUG) {
      console.log(`[diagnostic] unable_to_clear_cookie_jar=${error.message}`);
    }
  }
}

function requestParams(page, url) {
  const headers = {};

  if (BASIC_AUTH_USER && BASIC_AUTH_PASSWORD) {
    const credentials = `${BASIC_AUTH_USER}:${BASIC_AUTH_PASSWORD}`;
    headers.Authorization = `Basic ${encoding.b64encode(credentials)}`;
  }

  if (CACHE_VARIANT === 'no_cookie' || CACHE_VARIANT === 'minimal_headers') {
    clearCookies(url);
  } else if (OPTIONAL_COOKIE) {
    headers.Cookie = OPTIONAL_COOKIE;
  }

  if (CACHE_VARIANT !== 'no_consumer_id' && CACHE_VARIANT !== 'minimal_headers' && OPTIONAL_CONSUMER_ID) {
    headers['X-Consumer-ID'] = OPTIONAL_CONSUMER_ID;
  }

  return {
    headers,
    redirects: 0,
    tags: {
      page_name: page.name,
      page_path: page.path,
      auth: BASIC_AUTH_USER && BASIC_AUTH_PASSWORD ? 'basic' : 'none',
      cache_variant: CACHE_VARIANT,
    },
  };
}

function thinkTime(min = 1, max = 5) {
  sleep(Math.random() * (max - min) + min);
}

function absoluteUrl(location) {
  if (!location) {
    return '';
  }

  if (/^https?:\/\//i.test(location)) {
    return location;
  }

  if (location.startsWith('/')) {
    return `${BASE_URL}${location}`;
  }

  return `${BASE_URL}/${location}`;
}

function responseSize(res) {
  return res.body ? res.body.length : 0;
}

function cacheValue(headers) {
  const cacheHeaders = [
    headers['X-Cache'],
    headers['X-Drupal-Cache'],
    headers['X-Cache-Status'],
    headers['CF-Cache-Status'],
    headers['Fastly-Cache'],
  ]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();

  if (cacheHeaders.includes('HIT')) {
    return 'HIT';
  }

  if (cacheHeaders.includes('MISS')) {
    return 'MISS';
  }

  if (cacheHeaders.includes('BYPASS') || cacheHeaders.includes('PASS')) {
    return 'BYPASS';
  }

  return 'UNKNOWN';
}

function recordCache(headers) {
  const cacheState = cacheValue(headers);

  if (cacheState === 'HIT') {
    cacheHitCount.add(1);
  } else if (cacheState === 'MISS') {
    cacheMissCount.add(1);
  } else if (cacheState === 'BYPASS') {
    cacheBypassCount.add(1);
  } else {
    cacheUnknownCount.add(1);
  }

  return cacheState;
}

function headerValue(headers, name) {
  return headers[name] || headers[name.toLowerCase()] || '';
}

function cacheHeaderSummary(headers) {
  const names = [
    'Cache-Control',
    'Age',
    'Vary',
    'X-Cache',
    'X-Cache-Hits',
    'X-Served-By',
    'X-Timer',
    'X-Pantheon-Styx-Hostname',
    'X-Styx-Req-Id',
    'CF-Cache-Status',
  ];

  return names
    .map((name) => `${name}=${headerValue(headers, name) || 'n/a'}`)
    .join('; ');
}

function addPhaseMetrics(page, res) {
  const sizeMetric = responseSizeMetrics[page.name];

  if (sizeMetric) {
    sizeMetric.add(responseSize(res));
  }

  const metrics = phaseMetrics[page.name];

  if (!metrics) {
    return;
  }

  metrics.blocked.add(res.timings.blocked || 0);
  metrics.connecting.add(res.timings.connecting || 0);
  metrics.tls_handshaking.add(res.timings.tls_handshaking || 0);
  metrics.sending.add(res.timings.sending || 0);
  metrics.waiting.add(res.timings.waiting || 0);
  metrics.receiving.add(res.timings.receiving || 0);
}

function debugResponse(page, res, cacheState, redirectChain) {
  if (!VERBOSE_DEBUG) {
    return;
  }

  const shouldPrint = res.timings.duration >= SLOW_REQUEST_MS || redirectChain.length > 0 || res.status >= 400;

  if (!shouldPrint) {
    return;
  }

  console.log(
    [
      `[diagnostic] page=${page.name}`,
      `cache_variant=${CACHE_VARIANT}`,
      `status=${res.status}`,
      `url=${res.url}`,
      `duration_ms=${res.timings.duration.toFixed(2)}`,
      `size_bytes=${responseSize(res)}`,
      `cache=${cacheState}`,
      `blocked_ms=${(res.timings.blocked || 0).toFixed(2)}`,
      `connecting_ms=${(res.timings.connecting || 0).toFixed(2)}`,
      `tls_ms=${(res.timings.tls_handshaking || 0).toFixed(2)}`,
      `sending_ms=${(res.timings.sending || 0).toFixed(2)}`,
      `waiting_ms=${(res.timings.waiting || 0).toFixed(2)}`,
      `receiving_ms=${(res.timings.receiving || 0).toFixed(2)}`,
      `redirect_chain=${redirectChain.length > 0 ? redirectChain.join(' -> ') : 'none'}`,
      `headers=${cacheHeaderSummary(res.headers)}`,
    ].join(' | ')
  );
}

function fetchWithRedirects(page) {
  let currentUrl = `${BASE_URL}${page.path}`;
  const redirectChain = [];
  let res;

  for (let redirectIndex = 0; redirectIndex <= MAX_REDIRECTS; redirectIndex += 1) {
    res = http.get(currentUrl, requestParams(page, currentUrl));

    if (![301, 302, 303, 307, 308].includes(res.status)) {
      break;
    }

    const location = headerValue(res.headers, 'Location');
    const nextUrl = absoluteUrl(location);

    if (!nextUrl) {
      break;
    }

    redirectCount.add(1);
    redirectChain.push(`${res.status}:${currentUrl}=>${nextUrl}`);
    currentUrl = nextUrl;
  }

  return { res, redirectChain };
}

function getPage(page) {
  const { res, redirectChain } = fetchWithRedirects(page);
  const cacheState = recordCache(res.headers);

  page.trend.add(res.timings.duration);
  addPhaseMetrics(page, res);
  debugResponse(page, res, cacheState, redirectChain);

  check(res, {
    [`${page.name}: status is 200`]: (r) => r.status === 200,
    [`${page.name}: response body is not empty`]: (r) => Boolean(r.body && r.body.length > 0),
    [`${page.name}: response time is below 2000ms`]: (r) => r.timings.duration < 2000,
  });

  return res;
}

function findArticlePath(newsResponse) {
  if (!newsResponse || newsResponse.error || !newsResponse.body) {
    return '/news';
  }

  const links = newsResponse
    .html()
    .find('a')
    .toArray()
    .map((link) => link.attr('href'))
    .filter((href) => href && /^\/news\/[^?#/][^?#]*/.test(href));

  return links.length > 0 ? links[Math.floor(Math.random() * links.length)] : '/news';
}

function runSinglePage() {
  const page = pages[TEST_PAGE];

  if (!page) {
    throw new Error(`Unknown TEST_PAGE "${TEST_PAGE}". Use one of: ${Object.keys(pages).join(', ')}.`);
  }

  group(`Single page: ${page.name}`, () => {
    getPage(page);
  });
  thinkTime();
}

function runJourney() {
  let newsResponse;

  group('Homepage', () => {
    getPage(pages.homepage);
  });
  thinkTime();

  group('Events', () => {
    getPage(pages.events);
  });
  thinkTime();

  group('Athletes', () => {
    getPage(pages.athletes);
  });
  thinkTime();

  group('News listing', () => {
    newsResponse = getPage(pages.news);
  });
  thinkTime();

  const articlePath = findArticlePath(newsResponse);
  group('News article', () => {
    getPage({ name: 'news article', path: articlePath, trend: newsDuration });
  });
  thinkTime();
}

export default function () {
  if (TEST_MODE === 'single-page') {
    runSinglePage();
    return;
  }

  runJourney();
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function metricValue(data, metricName, field) {
  return data.metrics[metricName]?.values?.[field] ?? '';
}

function numericMetricValue(data, metricName, field) {
  const value = Number(metricValue(data, metricName, field));
  return Number.isFinite(value) ? value : NaN;
}

function pageMetricRows(data) {
  return [
    ['homepage_duration_p95_ms', metricValue(data, 'homepage_duration', 'p(95)')],
    ['homepage_duration_avg_ms', metricValue(data, 'homepage_duration', 'avg')],
    ['events_duration_p95_ms', metricValue(data, 'events_duration', 'p(95)')],
    ['events_duration_avg_ms', metricValue(data, 'events_duration', 'avg')],
    ['athletes_duration_p95_ms', metricValue(data, 'athletes_duration', 'p(95)')],
    ['athletes_duration_avg_ms', metricValue(data, 'athletes_duration', 'avg')],
    ['news_duration_p95_ms', metricValue(data, 'news_duration', 'p(95)')],
    ['news_duration_avg_ms', metricValue(data, 'news_duration', 'avg')],
    ['homepage_response_size_avg_bytes', metricValue(data, 'homepage_response_size', 'avg')],
    ['homepage_response_size_max_bytes', metricValue(data, 'homepage_response_size', 'max')],
    ['events_response_size_avg_bytes', metricValue(data, 'events_response_size', 'avg')],
    ['events_response_size_max_bytes', metricValue(data, 'events_response_size', 'max')],
    ['athletes_response_size_avg_bytes', metricValue(data, 'athletes_response_size', 'avg')],
    ['athletes_response_size_max_bytes', metricValue(data, 'athletes_response_size', 'max')],
    ['news_response_size_avg_bytes', metricValue(data, 'news_response_size', 'avg')],
    ['news_response_size_max_bytes', metricValue(data, 'news_response_size', 'max')],
    ['redirect_count', metricValue(data, 'redirect_count', 'count')],
    ['cache_hit_count', metricValue(data, 'cache_hit_count', 'count')],
    ['cache_miss_count', metricValue(data, 'cache_miss_count', 'count')],
    ['cache_bypass_count', metricValue(data, 'cache_bypass_count', 'count')],
    ['cache_unknown_count', metricValue(data, 'cache_unknown_count', 'count')],
  ];
}

function timingPhaseRows(data) {
  const pagesWithPhaseMetrics = ['homepage', 'events'];
  const phases = ['blocked', 'connecting', 'tls_handshaking', 'sending', 'waiting', 'receiving'];

  return pagesWithPhaseMetrics.flatMap((pageName) =>
    phases.flatMap((phase) => [
      [`${pageName}_${phase}_p95_ms`, metricValue(data, `${pageName}_${phase}`, 'p(95)')],
      [`${pageName}_${phase}_avg_ms`, metricValue(data, `${pageName}_${phase}`, 'avg')],
    ])
  );
}

function summaryCsv(data) {
  const rows = [
    ['metric', 'value'],
    ['http_req_failed_rate', metricValue(data, 'http_req_failed', 'rate')],
    ['http_req_duration_p95_ms', metricValue(data, 'http_req_duration', 'p(95)')],
    ['http_req_duration_avg_ms', metricValue(data, 'http_req_duration', 'avg')],
    ['http_reqs_count', metricValue(data, 'http_reqs', 'count')],
    ['iterations_count', metricValue(data, 'iterations', 'count')],
    ['vus_max', metricValue(data, 'vus_max', 'value')],
    ['cache_variant', CACHE_VARIANT],
    ...pageMetricRows(data),
    ...timingPhaseRows(data),
  ];

  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
}

function pageP95Values(data) {
  return [
    { name: 'homepage', p95: numericMetricValue(data, 'homepage_duration', 'p(95)') },
    { name: 'events', p95: numericMetricValue(data, 'events_duration', 'p(95)') },
    { name: 'athletes', p95: numericMetricValue(data, 'athletes_duration', 'p(95)') },
    { name: 'news', p95: numericMetricValue(data, 'news_duration', 'p(95)') },
  ];
}

function formatMetric(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : 'n/a';
}

function slowestPage(data) {
  const pagesByP95 = pageP95Values(data).filter((page) => Number.isFinite(page.p95));

  if (pagesByP95.length === 0) {
    return { name: 'n/a', p95: NaN };
  }

  return pagesByP95.sort((a, b) => b.p95 - a.p95)[0];
}

function slowestTimingPhase(data) {
  const phases = [
    { name: 'homepage blocked', value: numericMetricValue(data, 'homepage_blocked', 'p(95)') },
    { name: 'homepage connecting', value: numericMetricValue(data, 'homepage_connecting', 'p(95)') },
    { name: 'homepage TLS handshaking', value: numericMetricValue(data, 'homepage_tls_handshaking', 'p(95)') },
    { name: 'homepage sending', value: numericMetricValue(data, 'homepage_sending', 'p(95)') },
    { name: 'homepage waiting TTFB', value: numericMetricValue(data, 'homepage_waiting', 'p(95)') },
    { name: 'homepage receiving', value: numericMetricValue(data, 'homepage_receiving', 'p(95)') },
    { name: 'events blocked', value: numericMetricValue(data, 'events_blocked', 'p(95)') },
    { name: 'events connecting', value: numericMetricValue(data, 'events_connecting', 'p(95)') },
    { name: 'events TLS handshaking', value: numericMetricValue(data, 'events_tls_handshaking', 'p(95)') },
    { name: 'events sending', value: numericMetricValue(data, 'events_sending', 'p(95)') },
    { name: 'events waiting TTFB', value: numericMetricValue(data, 'events_waiting', 'p(95)') },
    { name: 'events receiving', value: numericMetricValue(data, 'events_receiving', 'p(95)') },
  ].filter((phase) => Number.isFinite(phase.value));

  if (phases.length === 0) {
    return { name: 'n/a', value: NaN };
  }

  return phases.sort((a, b) => b.value - a.value)[0];
}

function largestResponse(data) {
  const responses = [
    { name: 'homepage', value: numericMetricValue(data, 'homepage_response_size', 'max') },
    { name: 'events', value: numericMetricValue(data, 'events_response_size', 'max') },
    { name: 'athletes', value: numericMetricValue(data, 'athletes_response_size', 'max') },
    { name: 'news', value: numericMetricValue(data, 'news_response_size', 'max') },
  ].filter((response) => Number.isFinite(response.value));

  if (responses.length === 0) {
    return { name: 'n/a', value: NaN };
  }

  return responses.sort((a, b) => b.value - a.value)[0];
}

function failedThresholds(data) {
  const failures = [];

  for (const [metricName, metric] of Object.entries(data.metrics)) {
    if (!metric.thresholds) {
      continue;
    }

    for (const [threshold, result] of Object.entries(metric.thresholds)) {
      if (!result.ok) {
        failures.push(`${metricName}: ${threshold}`);
      }
    }
  }

  return failures;
}

function cacheObservations(data) {
  const hits = numericMetricValue(data, 'cache_hit_count', 'count') || 0;
  const misses = numericMetricValue(data, 'cache_miss_count', 'count') || 0;
  const bypasses = numericMetricValue(data, 'cache_bypass_count', 'count') || 0;
  const unknown = numericMetricValue(data, 'cache_unknown_count', 'count') || 0;

  if (misses > hits && misses > 0) {
    return `Cache MISS dominates (${misses} MISS vs ${hits} HIT). This can indicate cold CDN/object cache or cache fragmentation.`;
  }

  if (bypasses > 0) {
    return `Cache BYPASS/PASS observed ${bypasses} time(s). Review cookies, auth headers, and cache-control rules.`;
  }

  if (hits > 0) {
    return `Cache HIT observed ${hits} time(s). CDN caching appears active for at least some requests.`;
  }

  if (unknown > 0) {
    return `Cache state was unknown for ${unknown} request(s). Enable VERBOSE_DEBUG=true to inspect cache/CDN headers.`;
  }

  return 'No cache observations were recorded.';
}

function redirectObservations(data) {
  const redirects = numericMetricValue(data, 'redirect_count', 'count') || 0;
  return redirects > 0
    ? `${redirects} redirect hop(s) were observed. Enable VERBOSE_DEBUG=true to print redirect chains.`
    : 'No redirects were observed.';
}

function suspectedBottleneck(data) {
  const slowPhase = slowestTimingPhase(data);
  const largest = largestResponse(data);

  if (slowPhase.name.includes('waiting')) {
    return `${slowPhase.name} is the slowest timing phase at ${formatMetric(slowPhase.value)}ms p95, pointing to backend/origin/CDN TTFB rather than client download time.`;
  }

  if (slowPhase.name.includes('receiving')) {
    return `${slowPhase.name} is the slowest timing phase at ${formatMetric(slowPhase.value)}ms p95. Large response payloads may be contributing; largest tracked response is ${largest.name} at ${formatMetric(largest.value)} bytes.`;
  }

  if (slowPhase.name.includes('connecting') || slowPhase.name.includes('TLS')) {
    return `${slowPhase.name} is elevated at ${formatMetric(slowPhase.value)}ms p95, suggesting connection setup or TLS overhead.`;
  }

  return `${slowPhase.name} is the slowest tracked phase at ${formatMetric(slowPhase.value)}ms p95. Review verbose diagnostics for request-level evidence.`;
}

function summaryText(data) {
  const failedRate = metricValue(data, 'http_req_failed', 'rate');
  const durationP95 = metricValue(data, 'http_req_duration', 'p(95)');
  const requests = metricValue(data, 'http_reqs', 'count');
  const iterations = metricValue(data, 'iterations', 'count');
  const homepageP95 = metricValue(data, 'homepage_duration', 'p(95)');
  const eventsP95 = metricValue(data, 'events_duration', 'p(95)');
  const athletesP95 = metricValue(data, 'athletes_duration', 'p(95)');
  const newsP95 = metricValue(data, 'news_duration', 'p(95)');
  const slowest = slowestPage(data);
  const slowPhase = slowestTimingPhase(data);
  const thresholdFailures = failedThresholds(data);

  return [
    'UFC load test summary',
    '---------------------',
    `profile: ${TEST_PROFILE}`,
    `mode: ${TEST_MODE}`,
    `page: ${TEST_MODE === 'single-page' ? TEST_PAGE : 'journey'}`,
    `cache_variant: ${CACHE_VARIANT}`,
    `base_url: ${BASE_URL}`,
    `total_requests: ${requests}`,
    `iterations: ${iterations}`,
    `error_rate: ${formatMetric(failedRate)}`,
    `overall_p95_ms: ${formatMetric(durationP95)}`,
    `homepage_p95_ms: ${formatMetric(homepageP95)}`,
    `events_p95_ms: ${formatMetric(eventsP95)}`,
    `athletes_p95_ms: ${formatMetric(athletesP95)}`,
    `news_p95_ms: ${formatMetric(newsP95)}`,
    `slowest_page: ${slowest.name} (${formatMetric(slowest.p95)}ms p95)`,
    `slowest_timing_phase: ${slowPhase.name} (${formatMetric(slowPhase.value)}ms p95)`,
    `failed_thresholds: ${thresholdFailures.length > 0 ? thresholdFailures.join('; ') : 'none'}`,
    '',
  ].join('\n');
}

function diagnosticsReport(data) {
  const slowest = slowestPage(data);
  const slowPhase = slowestTimingPhase(data);
  const largest = largestResponse(data);
  const thresholdFailures = failedThresholds(data);

  return [
    '# UFC Diagnostics Report',
    '',
    `- Test date/time: ${new Date().toISOString()}`,
    `- Environment URL: ${BASE_URL}/`,
    `- Profile: ${TEST_PROFILE}`,
    `- Mode: ${TEST_MODE}`,
    `- Page: ${TEST_MODE === 'single-page' ? TEST_PAGE : 'journey'}`,
    `- Cache variant: ${CACHE_VARIANT}`,
    `- Total requests: ${metricValue(data, 'http_reqs', 'count')}`,
    `- Iterations: ${metricValue(data, 'iterations', 'count')}`,
    `- Error rate: ${formatMetric(metricValue(data, 'http_req_failed', 'rate'))}`,
    `- Overall p95: ${formatMetric(metricValue(data, 'http_req_duration', 'p(95)'))}ms`,
    '',
    '## Page Latency',
    '',
    '| Page | p95 | avg |',
    '| --- | ---: | ---: |',
    `| homepage | ${formatMetric(metricValue(data, 'homepage_duration', 'p(95)'))}ms | ${formatMetric(metricValue(data, 'homepage_duration', 'avg'))}ms |`,
    `| events | ${formatMetric(metricValue(data, 'events_duration', 'p(95)'))}ms | ${formatMetric(metricValue(data, 'events_duration', 'avg'))}ms |`,
    `| athletes | ${formatMetric(metricValue(data, 'athletes_duration', 'p(95)'))}ms | ${formatMetric(metricValue(data, 'athletes_duration', 'avg'))}ms |`,
    `| news | ${formatMetric(metricValue(data, 'news_duration', 'p(95)'))}ms | ${formatMetric(metricValue(data, 'news_duration', 'avg'))}ms |`,
    '',
    '## Timing Phase Analysis',
    '',
    `- Slowest timing phase: ${slowPhase.name} at ${formatMetric(slowPhase.value)}ms p95`,
    `- Homepage waiting TTFB p95: ${formatMetric(metricValue(data, 'homepage_waiting', 'p(95)'))}ms`,
    `- Homepage receiving p95: ${formatMetric(metricValue(data, 'homepage_receiving', 'p(95)'))}ms`,
    `- Events waiting TTFB p95: ${formatMetric(metricValue(data, 'events_waiting', 'p(95)'))}ms`,
    `- Events receiving p95: ${formatMetric(metricValue(data, 'events_receiving', 'p(95)'))}ms`,
    '',
    '## Response Size',
    '',
    `- Homepage average response size: ${formatMetric(metricValue(data, 'homepage_response_size', 'avg'))} bytes`,
    `- Homepage max response size: ${formatMetric(metricValue(data, 'homepage_response_size', 'max'))} bytes`,
    `- Events average response size: ${formatMetric(metricValue(data, 'events_response_size', 'avg'))} bytes`,
    `- Events max response size: ${formatMetric(metricValue(data, 'events_response_size', 'max'))} bytes`,
    `- Athletes average response size: ${formatMetric(metricValue(data, 'athletes_response_size', 'avg'))} bytes`,
    `- Athletes max response size: ${formatMetric(metricValue(data, 'athletes_response_size', 'max'))} bytes`,
    `- News average response size: ${formatMetric(metricValue(data, 'news_response_size', 'avg'))} bytes`,
    `- News max response size: ${formatMetric(metricValue(data, 'news_response_size', 'max'))} bytes`,
    `- Largest tracked response: ${largest.name} (${formatMetric(largest.value)} bytes)`,
    '',
    '## Cache Observations',
    '',
    `- ${cacheObservations(data)}`,
    '',
    '## Redirect Observations',
    '',
    `- ${redirectObservations(data)}`,
    '',
    '## Suspected Bottleneck Cause',
    '',
    `- Slowest page: ${slowest.name} (${formatMetric(slowest.p95)}ms p95)`,
    `- ${suspectedBottleneck(data)}`,
    '',
    '## Failed Thresholds',
    '',
    thresholdFailures.length > 0 ? thresholdFailures.map((failure) => `- ${failure}`).join('\n') : '- none',
    '',
    '## Recommendations',
    '',
    '- Run single-page diagnostics for the slowest page with `TEST_MODE=single-page` and `VERBOSE_DEBUG=true`.',
    '- If waiting TTFB dominates, review origin rendering time, Pantheon cacheability, CDN cache status, and backend dependencies.',
    '- If receiving dominates, inspect HTML payload size, compression, and cache headers.',
    '- If redirects are present, remove unnecessary redirects before continuing load testing.',
    '- Keep using the smoke profile as the main validation gate before running low.',
    '',
  ].join('\n');
}

export function handleSummary(data) {
  return {
    stdout: summaryText(data),
    [`results/${OUTPUT_BASENAME}.json`]: JSON.stringify(data, null, 2),
    [`results/${OUTPUT_BASENAME}.csv`]: summaryCsv(data),
    'results/diagnostics-report.md': diagnosticsReport(data),
  };
}
