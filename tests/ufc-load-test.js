import http from 'k6/http';
import { check, sleep } from 'k6';
import {
  defaultThresholds,
  environments,
  loadProfiles,
} from '../config/environments.js';

const ENVIRONMENT = __ENV.ENVIRONMENT || 'develop';
const LOAD_PROFILE = __ENV.LOAD_PROFILE || 'smoke';
const OUTPUT_BASENAME = __ENV.OUTPUT_BASENAME || `ufc-${LOAD_PROFILE}-summary`;
const BASE_URL = (__ENV.BASE_URL || environments[ENVIRONMENT]?.baseUrl || '').replace(/\/$/, '');
const PROFILE = loadProfiles[LOAD_PROFILE];

if (!BASE_URL) {
  throw new Error(`Unknown environment "${ENVIRONMENT}". Set ENVIRONMENT or BASE_URL.`);
}

if (!PROFILE) {
  throw new Error(`Unknown load profile "${LOAD_PROFILE}". Use one of: ${Object.keys(loadProfiles).join(', ')}.`);
}

if (['high', 'target'].includes(LOAD_PROFILE) && __ENV.APPROVED_HIGH_LOAD !== 'true') {
  throw new Error(
    `${LOAD_PROFILE} tests require approval. Re-run with -e APPROVED_HIGH_LOAD=true only after authorization.`
  );
}

export const options = {
  scenarios: {
    ufc_user_journey: PROFILE,
  },
  thresholds: defaultThresholds,
};

const journey = [
  { name: 'homepage', path: '/' },
  { name: 'events page', path: '/events' },
  { name: 'athletes page', path: '/athletes' },
  { name: 'news listing', path: '/news' },
];

function thinkTime(min = 1, max = 4) {
  sleep(Math.random() * (max - min) + min);
}

function getPage(page) {
  const res = http.get(`${BASE_URL}${page.path}`, {
    tags: {
      page_name: page.name,
      page_path: page.path,
    },
  });

  check(res, {
    [`${page.name}: status is 200`]: (r) => r.status === 200,
    [`${page.name}: p95 target guard < 1500ms`]: (r) => r.timings.duration < 1500,
  });

  return res;
}

function findArticlePath(newsResponse) {
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

  for (const page of journey) {
    const res = getPage(page);

    if (page.path === '/news') {
      newsResponse = res;
    }

    thinkTime();
  }

  const articlePath = findArticlePath(newsResponse);
  getPage({ name: 'news article', path: articlePath });
  thinkTime();
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function metricValue(data, metricName, field) {
  return data.metrics[metricName]?.values?.[field] ?? '';
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
  ];

  return `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
}

function summaryText(data) {
  const failedRate = metricValue(data, 'http_req_failed', 'rate');
  const durationP95 = metricValue(data, 'http_req_duration', 'p(95)');
  const requests = metricValue(data, 'http_reqs', 'count');
  const iterations = metricValue(data, 'iterations', 'count');

  return [
    'UFC load test summary',
    `profile: ${LOAD_PROFILE}`,
    `base_url: ${BASE_URL}`,
    `http_req_failed_rate: ${failedRate}`,
    `http_req_duration_p95_ms: ${durationP95}`,
    `http_reqs_count: ${requests}`,
    `iterations_count: ${iterations}`,
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
