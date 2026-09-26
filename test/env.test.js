const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Exercise the server's startup configuration in isolation from its HTTP listener.
const startup = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').split('const sessions =')[0];

function loadConfig(t, files, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reaction-room-env-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, name), contents);
  }
  fs.writeFileSync(path.join(directory, 'config.cjs'), `${startup}\nfs.writeFileSync(path.join(__dirname, 'result.json'), JSON.stringify({ userBearerToken, adminBearerToken, port }));`);
  const env = { ...process.env };
  delete env.USER_TOKEN;
  delete env.ADMIN_TOKEN;
  delete env.PORT;
  const result = spawnSync(process.execPath, [path.join(directory, 'config.cjs')], {
    cwd: os.tmpdir(), env: { ...env, ...overrides }, encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(fs.readFileSync(path.join(directory, 'result.json'), 'utf8'));
}

test('loads quoted tokens, comments and port from project .env', (t) => {
  assert.deepEqual(loadConfig(t, {
    '.env': '# Access configuration\nUSER_TOKEN="audience#value" # comment\nADMIN_TOKEN=\'admin=value\'\nPORT=4321\n'
  }), { userBearerToken: 'audience#value', adminBearerToken: 'admin=value', port: 4321 });
});

test('host environment takes precedence over .env', (t) => {
  assert.deepEqual(loadConfig(t, {
    '.env': 'USER_TOKEN=file-user\nADMIN_TOKEN=file-admin\nPORT=4321\n'
  }, { USER_TOKEN: 'host-user', ADMIN_TOKEN: 'host-admin', PORT: '5432' }), {
    userBearerToken: 'host-user', adminBearerToken: 'host-admin', port: 5432
  });
});

test('missing .env permits host-only configuration', (t) => {
  assert.deepEqual(loadConfig(t, {}, { USER_TOKEN: 'host-user', ADMIN_TOKEN: 'host-admin' }), {
    userBearerToken: 'host-user', adminBearerToken: 'host-admin', port: 3000
  });
});

test('legacy files and shell USER do not supply missing tokens', (t) => {
  assert.deepEqual(loadConfig(t, {
    '.tokens': 'USER=old-user\nADMIN=old-admin\n', '.token': 'old-token'
  }, { USER: 'shell-user' }), { userBearerToken: '', adminBearerToken: '', port: 3000 });
});
