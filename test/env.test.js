const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Exercise the server's startup configuration in isolation from its HTTP listener.
const startup = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').split('const sessions =')[0];

function loadConfig(t, files, overrides = {}, prelude = '') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reaction-room-env-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, name), contents);
  }
  fs.writeFileSync(path.join(directory, 'config.cjs'), `${prelude}\n${startup}\nfs.writeFileSync(path.join(__dirname, 'result.json'), JSON.stringify({ userBearerToken, adminBearerToken, port }));`);
  const env = { ...process.env };
  delete env.USERBEAR;
  delete env.ADMINBEAR;
  delete env.PORT;
  const result = spawnSync(process.execPath, [path.join(directory, 'config.cjs')], {
    cwd: os.tmpdir(), env: { ...env, ...overrides }, encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(fs.readFileSync(path.join(directory, 'result.json'), 'utf8'));
}

test('loads quoted tokens, comments and port from project .env', (t) => {
  assert.deepEqual(loadConfig(t, {
    '.env': '# Access configuration\nUSERBEAR="audience#value" # comment\nADMINBEAR=\'admin=value\'\nPORT=4321\n'
  }), { userBearerToken: 'audience#value', adminBearerToken: 'admin=value', port: 4321 });
});

test('host environment takes precedence over .env', (t) => {
  assert.deepEqual(loadConfig(t, {
    '.env': 'USERBEAR=file-user\nADMINBEAR=file-admin\nPORT=4321\n'
  }, { USERBEAR: 'host-user', ADMINBEAR: 'host-admin', PORT: '5432' }), {
    userBearerToken: 'host-user', adminBearerToken: 'host-admin', port: 5432
  });
});

test('missing .env permits host-only configuration', (t) => {
  assert.deepEqual(loadConfig(t, {}, { USERBEAR: 'host-user', ADMINBEAR: 'host-admin' }), {
    userBearerToken: 'host-user', adminBearerToken: 'host-admin', port: 3000
  });
});

test('legacy files and shell USER do not supply missing tokens', (t) => {
  assert.deepEqual(loadConfig(t, {
    '.tokens': 'USER=old-user\nADMIN=old-admin\n', '.token': 'old-token'
  }, { USER: 'shell-user' }), { userBearerToken: '', adminBearerToken: '', port: 3000 });
});


test('invalid ports fall back safely', (t) => {
  for (const PORT of ['-1', 'Infinity', '65536', '3.14', 'abc', '0']) {
    assert.equal(loadConfig(t, {}, { PORT }).port, 3000);
  }
});

test('blank tokens disable access and surrounding whitespace is removed', (t) => {
  assert.deepEqual(loadConfig(t, {}, { USERBEAR: '   ', ADMINBEAR: ' admin ', PORT: ' 8080 ' }), {
    userBearerToken: '', adminBearerToken: 'admin', port: 8080
  });
});

test('older runtimes can boot with injected variables', (t) => {
  assert.equal(loadConfig(t, { '.env': 'USERBEAR=file-user' }, { USERBEAR: 'host-user' },
    'process.loadEnvFile = undefined;').userBearerToken, 'host-user');
});

test('unreadable optional .env does not crash startup', (t) => {
  assert.equal(loadConfig(t, {}, { ADMINBEAR: 'host-admin' },
    "process.loadEnvFile = () => { throw Object.assign(new Error('unreadable'), { code: 'EACCES' }); };").adminBearerToken, 'host-admin');
});

test('listener binds externally and retries bind failures on the configured port', () => {
  const vm = require('node:vm');
  const { EventEmitter } = require('node:events');
  const server = new EventEmitter();
  const attempts = [];
  const retries = [];
  server.listen = (...args) => attempts.push(args);
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  vm.runInNewContext(source.slice(source.indexOf('// Keep bind failures')), {
    server, port: 8080, console: { log() {}, error() {} },
    setTimeout: (callback, delay) => retries.push({ callback, delay })
  });
  assert.deepEqual(attempts, [[8080, '0.0.0.0']]);
  server.emit('error', Object.assign(new Error('occupied'), { code: 'EADDRINUSE' }));
  assert.equal(retries.length, 1);
  assert.equal(retries[0].delay, 10_000);
  retries[0].callback();
  assert.deepEqual(attempts, [[8080, '0.0.0.0'], [8080, '0.0.0.0']]);
});
