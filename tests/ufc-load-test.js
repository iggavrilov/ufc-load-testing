import http from 'k6/http';
import { check, group, sleep } from 'k6';
import encoding from 'k6/encoding';
import { Trend } from 'k6/metrics';
import {
  defaultThresholds,
  environments,
  loadProfiles,
} from '../config/environments.js';

const ENVIRONMENT = __ENV.ENVIRONMENT || 'develop';
const TEST_PROFILE = __ENV.TEST_PROFILE || __ENV.LOAD_PROFILE || 'smoke';
const OUTPUT_BASENAME = __ENV.OUTPUT_BASENAME || `ufc-${TEST_PROFILE}-summary`;
const BASE_URL = (__ENV.BASE_URL || environments[ENVIRONMENT]?.baseUrl || '').replace(/\/$/, '');
const PROFILE = loadProfiles[TEST_PROFILE];
const BASIC_AUTH_USER = __ENV.BASIC_AUTH_USER;
const BASIC_AUTH_PASSWORD = __ENV.BASIC_AUTH_PASSWORD;

const homepageDuration = new Trend('homepage_duration', true);
const eventsDuration = new Trend('events_duration', true);
const athletesDuration = new Trend('athletes_duration', true);
const newsDuration = new Trend('news_duration', true);

if (!BASE_URL) {
  throw new Error(`Unknown environment "${ENVIRONMENT}". Set ENVIRONMENT or BASE_URL.`);
}

if (!PROFILE) {
  throw new Error(`Unknown test profile "${TEST_PROFILE}". Use one of: ${Object.keys(loadProfiles).join(', ')}.`);
}

export const options = {
  scenarios: {
    ufc_user_journey: PROFILE,
  },
  thresholds: defaultThresholds,
};

const pages = {
  homepage: { name: 'homepage', path: '/', trend: homepageDuration },
  events: { name: 'events', path: '/events', trend: eventsDuration },
  athletes: { name: 'athletes', path: '/athletes', trend: athletesDuration },
  news: { name: 'news', path: '/news', trend: newsDuration },
};

function requestParams(page) {
  const headers = {};

  if (BASIC_AUTH_USER && BASIC_AUTH_PASSWORD) {
    const credentials = `${BASIC_AUTH_USER}:${BASIC_AUTH_PASSWORD}`;
    headers.Authorization = `Basic ${encoding.b64encode(credentials)}`;
  }

  return {
    headers,
    tags: {
      page_name: page.name,
      page_path: page.path,
      auth: BASIC_AUTH_USER && BASIC_AUTH_PASSWORD ? 'basic' : 'none',
    },
  };
}

function thinkTime(min = 1, max = 5) {
  sleep(Math.random() * (max - min) + min);
}

function getPage(page) {
  const res = http.get(`${BASE_URL}${page.path}`, requestParams(page));
  page.trend.add(res.timings.duration);

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

export default function () {
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

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function metricValue(data, metricName, field) {
  return data.metrics[metricName]?.values?.[field] ?? '';
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
  ];
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
    ...pageMetricRows(data),
  ];

  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
}

function pageP95Values(data) {
  return [
    { name: 'homepage', p95: Number(metricValue(data, 'homepage_duration', 'p(95)')) },
    { name: 'events', p95: Number(metricValue(data, 'events_duration', 'p(95)')) },
    { name: 'athletes', p95: Number(metricValue(data, 'athletes_duration', 'p(95)')) },
    { name: 'news', p95: Number(metricValue(data, 'news_duration', 'p(95)')) },
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
  const thresholdFailures = failedThresholds(data);

  return [
    'UFC load test summary',
    '---------------------',
    `profile: ${TEST_PROFILE}`,
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
    `failed_thresholds: ${thresholdFailures.length > 0 ? thresholdFailures.join('; ') : 'none'}`,
    '',
  ].join('\n');
}

export function handleSummary(data) {
  return {
    stdout: summaryText(data),
    [`results/${OUTPUT_BASENAME}.json`]: JSON.stringify(data, null, 2),
    [`results/${OUTPUT_BASENAME}.csv`]: summaryCsv(data),
  };
}
