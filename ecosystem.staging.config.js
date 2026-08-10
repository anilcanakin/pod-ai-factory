// PM2 ecosystem config — SADECE staging process'leri.
// Production (factory-backend, factory-frontend) doğrudan `pm2 start` ile
// başlatılmıştı, bu dosyaya dahil değil — `pm2 start ecosystem.staging.config.js`
// yalnızca aşağıdaki 2 yeni process'i ekler, mevcut prod process'lere dokunmaz.
module.exports = {
  apps: [
    {
      name: 'factory-backend-staging',
      script: 'src/index.js',
      cwd: __dirname,
      interpreter: 'node',
      node_args: '-r dotenv/config',
      env: {
        DOTENV_CONFIG_PATH: '.env.staging',
      },
    },
    {
      name: 'factory-frontend-staging',
      script: 'npm',
      args: 'run start:staging',
      cwd: `${__dirname}/frontend`,
    },
  ],
};
