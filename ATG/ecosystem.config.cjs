/**
 * pm2 process config for the production single-origin server
 * (API + built client served from one process).
 *
 *   npm run build
 *   npm run start:pm2          # or: pm2 start ecosystem.config.cjs --env production
 *   pm2 save && pm2 startup    # survive reboots
 *
 * NODE_ENV=production makes the server refuse to boot with default secrets,
 * enable the CORS allowlist and serve client/dist itself.
 */
module.exports = {
  apps: [
    {
      name: 'atg-api',
      cwd: __dirname + '/server',
      script: 'dist/src/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      min_uptime: '10s',
      max_memory_restart: '512M',
      out_file: '../logs/pm2-out.log',
      error_file: '../logs/pm2-error.log',
      merge_logs: true,
      time: true,
      env: { NODE_ENV: 'development' },
      env_production: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: '4000',
      },
    },
  ],
};
