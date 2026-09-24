module.exports = {
  apps: [{
    name: 'honkai-chat', cwd: __dirname, script: 'server/index.mjs',
    instances: 1, exec_mode: 'fork', autorestart: true,
    env: { NODE_ENV: 'production', PORT: '3001' },
    kill_timeout: 5000,
  }],
};
