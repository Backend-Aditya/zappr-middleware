const os = require('node:os')

// WEB_CONCURRENCY caps cluster size on memory-constrained hosts (e.g. Render free tier).
const webInstances
  = Number(process.env.WEB_CONCURRENCY)
    || Math.max(2, Math.floor(os.cpus().length / 2))

const apps = [
  {
    name: 'zappr-middleware',
    script: 'server.js',
    instances: webInstances,
    exec_mode: 'cluster',
    watch: false,
    env_production: { NODE_ENV: 'production' },
  },
  {
    name: 'zappr-worker',
    script: 'src/queue/workers/orderPushWorker.js',
    instances: 1,
    exec_mode: 'fork',
  },
  {
    name: 'zappr-tracking-worker',
    script: 'src/queue/workers/trackingPollWorker.js',
    instances: 1,
    exec_mode: 'fork',
  },
  {
    name: 'zappr-maintenance-worker',
    script: 'src/queue/workers/maintenanceWorker.js',
    instances: 1,
    exec_mode: 'fork',
  },
]

// In mock mode the mock Zappr server must run alongside the app so
// ZAPPR_MOCK_URL=http://localhost:4001 resolves inside the same host/container.
if (process.env.ZAPPR_MODE !== 'live') {
  apps.push({
    name: 'zappr-mock-server',
    script: 'mock-zappr-server/server.js',
    instances: 1,
    exec_mode: 'fork',
    // Pin the port: hosts like Render inject PORT for the web process,
    // and the mock server must not bind the same port as the main app.
    env: { PORT: 4001 },
  })
}

module.exports = { apps }
