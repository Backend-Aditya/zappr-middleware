const os = require('node:os')

module.exports = {
  apps: [
    {
      name: 'zappr-middleware',
      script: 'server.js',
      instances: Math.max(2, Math.floor(os.cpus().length / 2)),
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
  ],
}
