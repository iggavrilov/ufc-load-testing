export const environments = {
  develop: {
    baseUrl: 'https://develop.pantheon-multidev.ufc.com',
  },
};

export const loadProfiles = {
  smoke: {
    executor: 'ramping-vus',
    stages: [
      { duration: '30s', target: 10 },
      { duration: '1m', target: 10 },
      { duration: '30s', target: 0 },
    ],
  },
  low: {
    executor: 'ramping-vus',
    stages: [
      { duration: '2m', target: 10 },
      { duration: '3m', target: 100 },
      { duration: '5m', target: 100 },
      { duration: '2m', target: 0 },
    ],
  },
  medium: {
    executor: 'ramping-vus',
    stages: [
      { duration: '2m', target: 10 },
      { duration: '5m', target: 100 },
      { duration: '10m', target: 1000 },
      { duration: '10m', target: 1000 },
      { duration: '5m', target: 0 },
    ],
  },
  high: {
    executor: 'ramping-vus',
    stages: [
      { duration: '2m', target: 10 },
      { duration: '5m', target: 100 },
      { duration: '10m', target: 1000 },
      { duration: '20m', target: 10000 },
      { duration: '15m', target: 10000 },
      { duration: '10m', target: 0 },
    ],
  },
  target: {
    executor: 'ramping-vus',
    stages: [
      { duration: '2m', target: 10 },
      { duration: '5m', target: 100 },
      { duration: '10m', target: 1000 },
      { duration: '20m', target: 10000 },
      { duration: '45m', target: 60000 },
      { duration: '30m', target: 60000 },
      { duration: '20m', target: 0 },
    ],
  },
};

export const defaultThresholds = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<1500'],
};
