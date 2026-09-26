const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const audienceToken = source.match(/const userBearerToken = "([^"]+)"/)[1];
const adminToken = source.match(/const adminBearerToken = "([^"]+)"/)[1];

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reaction-logs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function boot(logDir) {
  let handler;
  const processStub = new EventEmitter();
  processStub.env = { LOG_DIR: logDir };
  processStub.exit = () => processStub.emit('exit');
  const server = new EventEmitter();
  server.listen = () => {};
  vm.runInNewContext(source, {
    require: (name) => name === 'node:http' ? {
      createServer(callback) { handler = callback; return server; }
    } : require(name),
    __dirname: path.dirname(logDir), process: processStub, Buffer, URL,
    console: { log() {}, warn() {}, error() {} }, setInterval() {}, setTimeout() {}
  });
  return {
    stop: (signal = 'SIGTERM') => processStub.emit(signal),
    async request(route, body = {}, cookie = '', token = audienceToken, method = 'POST') {
      const req = new EventEmitter();
      Object.assign(req, { method, url: `${route}?bearer=${token}`, headers: { cookie }, resume() {} });
      const res = {
        writeHead(status, headers) { this.status = status; this.headers = headers; },
        end(body) { this.body = JSON.parse(body); }
      };
      const done = handler(req, res);
      req.emit('data', JSON.stringify(body));
      req.emit('end');
      await done;
      return res;
    }
  };
}

function records(dir) {
  return fs.readdirSync(dir).sort().flatMap((file) =>
    fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n').map(JSON.parse));
}

test('reactions, lifecycle, admin toggle and nuke persist across restarts', async (t) => {
  const dir = directory(t);
  const app = boot(dir);
  const name = 'Audience\n"member"';
  const login = await app.request('/api/login', { name });
  const sid = login.headers['Set-Cookie'].split(';')[0];
  await app.request('/api/agree', {}, sid);
  const cookie = `${sid}; eula_agreed=1`;
  assert.equal((await app.request('/api/reactions', { id: 'heart' }, cookie)).status, 200);
  assert.equal((await app.request('/api/reactions', { id: 'unknown' }, cookie)).status, 400);
  await app.request('/api/admin/publishing', { enabled: false }, '', adminToken);
  await app.request('/api/reactions', { id: 'fire' }, cookie);
  await app.request('/api/admin/publishing', { enabled: true }, '', adminToken);
  await app.request('/api/logout', {}, cookie);
  await app.request('/api/admin/expire-sessions', {}, '', adminToken);
  await app.request('/api/admin/revoke-eula', {}, '', adminToken);
  assert.equal((await app.request('/api/admin/nuke', {}, '', adminToken)).status, 200);
  app.stop();
  const restarted = boot(dir);
  restarted.stop('SIGINT');
  const entries = records(dir);
  assert.deepEqual(entries.map((entry) => entry.action), ['start', 'reaction', 'publishing_changed', 'publishing_changed', 'nuke', 'shutdown', 'start', 'shutdown']);
  assert.deepEqual(entries.filter((entry) => entry.action === 'publishing_changed').map((entry) => entry.enabled), [false, true]);
  assert.equal(entries[1].reaction.name, name);
  assert.equal(entries[1].reaction.id, 'heart');
  assert.ok(entries.every((entry) => Number.isFinite(Date.parse(entry.at))));
  const text = JSON.stringify(entries);
  for (const secret of [audienceToken, adminToken, sid.split('=')[1]]) assert.ok(!text.includes(secret));
});

test('log failures reject reactions, admin toggle and nuke without applying them', async (t) => {
  const dir = directory(t);
  const logDir = path.join(dir, 'logs');
  const app = boot(logDir);
  const login = await app.request('/api/login', { name: 'Tester' });
  const sid = login.headers['Set-Cookie'].split(';')[0];
  await app.request('/api/agree', {}, sid);
  fs.renameSync(logDir, path.join(dir, 'saved'));
  fs.writeFileSync(logDir, 'blocks directory creation');
  assert.equal((await app.request('/api/reactions', { id: 'heart' }, `${sid}; eula_agreed=1`)).status, 500);
  assert.deepEqual((await app.request('/api/reactions', {}, '', audienceToken, 'GET')).body, []);
  assert.equal((await app.request('/api/admin/nuke', {}, '', adminToken)).status, 500);
  assert.equal((await app.request('/api/admin/publishing', { enabled: false }, '', adminToken)).status, 500);
  const status = await app.request('/api/status', {}, '', audienceToken, 'GET');
  assert.equal(status.body.publishingEnabled, true);
  assert.equal(status.body.serviceNuked, false);
  assert.throws(() => boot(logDir));
});
