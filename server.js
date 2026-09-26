const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function readTokenFile(fileName) {
  try {
    const contents = fs.readFileSync(path.join(__dirname, fileName), 'utf8').trim();
    const namedTokens = {};
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match) namedTokens[match[1].toUpperCase()] = match[2].trim();
    }
    return Object.keys(namedTokens).length ? namedTokens : { raw: contents };
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function configuredToken(config, names) {
  for (const name of names) {
    if (config[name]) return config[name];
  }
  return config.raw || '';
}

const port = Number(process.env.PORT) || 3000;
const publicDir = path.join(__dirname, 'public');
const tokenConfig = readTokenFile('.tokens');
const legacyUserTokenConfig = readTokenFile('.token');
const userBearerToken = configuredToken(tokenConfig, ['USER', 'USER_TOKEN', 'AUDIENCE', 'AUDIENCE_TOKEN']) || configuredToken(legacyUserTokenConfig, ['USER', 'USER_TOKEN', 'AUDIENCE', 'AUDIENCE_TOKEN']);
const adminBearerToken = configuredToken(tokenConfig, ['ADMIN', 'ADMIN_TOKEN']);
const sessions = new Map();
const eventClients = new Set();
const reactions = [];
const pendingReactions = [];
const batchIntervalMs = 150;
let publishingEnabled = true;
let requiredEulaVersion = 1;
let serviceNuked = false;

const emojis = [
  { id: 'heart', emoji: '❤️', label: 'Heart' },
  { id: 'fire', emoji: '🔥', label: 'Fire' },
  { id: 'joy', emoji: '😂', label: 'Joy' },
  { id: 'poop', emoji: '💩', label: 'Poop' },
  { id: 'party', emoji: '🥳', label: 'Party' },
  { id: 'wow', emoji: '😮', label: 'Wow' },
  { id: 'sparkles', emoji: '✨', label: 'Sparkles' },
  { id: 'clap', emoji: '👏', label: 'Applause' }
];

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function tokensMatch(expected, received) {
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function getBearerToken(req) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  return (requestUrl.searchParams.get('bearer') || '').trim();
}

function requireBearer(req, res, expectedToken, label) {
  const tokenCode = `${label.toUpperCase()}_TOKEN`;
  if (!expectedToken) {
    sendJson(res, 503, { error: `${label} access token is not configured.`, code: `${tokenCode}_NOT_CONFIGURED` });
    return false;
  }
  if (!tokensMatch(expectedToken, getBearerToken(req))) {
    sendJson(res, 401, { error: `A valid ${label.toLowerCase()} bearer token is required.`, code: `${tokenCode}_INVALID` });
    return false;
  }
  return true;
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function getSession(req) {
  return sessions.get(parseCookies(req).sid);
}

function hasCurrentEula(req) {
  return parseCookies(req).eula_agreed === String(requiredEulaVersion);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10_000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function broadcastBatch(batch) {
	if (!publishingEnabled) return;
	const message = `event: batch\ndata: ${JSON.stringify(batch)}\n\n`;
	for (const client of eventClients) client.write(message);
}

function closeEventClients() {
	for (const client of eventClients)
		client.end();
	eventClients.clear();
}

setInterval(() => {
	if (!publishingEnabled) {
		pendingReactions.length = 0;
		return;
	}
	if (!pendingReactions.length) return;
  const batch = pendingReactions.splice(0, 50);
  broadcastBatch(batch);
}, batchIntervalMs);

function serveStatic(req, res) {
  const requestedPath = req.url.split('?')[0];
  const requested = requestedPath === '/' ? '/index.html' : requestedPath;
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) return sendJson(res, 403, { error: 'Forbidden' });
  fs.readFile(filePath, (error, file) => {
    if (error) return sendJson(res, 404, { error: 'Not found' });
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': `${types[path.extname(filePath)] || 'application/octet-stream'}; charset=utf-8` });
    res.end(file);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const requestPath = requestUrl.pathname;

    if (req.method === 'POST' && requestPath === '/api/login') {
      if (!requireBearer(req, res, userBearerToken, 'Audience')) return;
      const body = await readBody(req);
      const name = String(body.name || '').trim().slice(0, 40);
      if (!name) return sendJson(res, 400, { error: 'Please enter a name.' });
      const sid = crypto.randomUUID();
      const agreed = hasCurrentEula(req);
      // Names are cosmetic labels only. They are neither unique nor credentials.
      sessions.set(sid, { name, agreed, eulaVersion: agreed ? requiredEulaVersion : 0, createdAt: Date.now() });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax` });
      return res.end(JSON.stringify({ name, agreed }));
    }

    if (req.method === 'POST' && requestPath === '/api/logout') {
      if (!requireBearer(req, res, userBearerToken, 'Audience')) return;
      const sid = parseCookies(req).sid;
      if (sid) sessions.delete(sid);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': 'sid=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax' });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (req.method === 'POST' && requestPath === '/api/agree') {
      if (!requireBearer(req, res, userBearerToken, 'Audience')) return;
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'Session expired. Please start again.', code: 'SESSION_EXPIRED' });
      session.agreed = true;
      session.eulaVersion = requiredEulaVersion;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `eula_agreed=${requiredEulaVersion}; Path=/; SameSite=Lax` });
      return res.end(JSON.stringify({ agreed: true }));
    }

    if (req.method === 'POST' && requestPath === '/api/reactions') {
      if (!requireBearer(req, res, userBearerToken, 'Audience')) return;
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'Session expired. Please start again.', code: 'SESSION_EXPIRED' });
      if (!session.agreed || session.eulaVersion !== requiredEulaVersion || !hasCurrentEula(req)) return sendJson(res, 403, { error: 'Please agree to the EULA first.' });
      if (!publishingEnabled) {
        req.resume();
        return sendJson(res, 200, { ok: true });
      }
      const body = await readBody(req);
      const option = emojis.find((item) => item.id === body.id);
      if (!option) return sendJson(res, 400, { error: 'Unknown reaction.' });
      const reaction = { ...option, emoji: option.id, name: session.name, at: new Date().toISOString() };
      reactions.unshift(reaction);
      reactions.splice(50);
      if (publishingEnabled && pendingReactions.length < 5000) pendingReactions.push(reaction);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && requestPath === '/api/reactions') {
	  if (!requireBearer(req, res, userBearerToken, 'Audience')) return;
	  if (!publishingEnabled) return sendJson(res, 503, { error: 'Reaction publishing is disabled.' });
      return sendJson(res, 200, reactions);
    }

    if (req.method === 'GET' && requestPath === '/api/session') {
      if (!requireBearer(req, res, userBearerToken, 'Audience')) return;
      const session = getSession(req);
      const agreed = Boolean(session?.agreed && session.eulaVersion === requiredEulaVersion && hasCurrentEula(req));
      return sendJson(res, 200, { name: session?.name || null, agreed, serviceNuked });
    }

    if (req.method === 'GET' && requestPath === '/api/status') {
      return sendJson(res, 200, { publishingEnabled, serviceNuked });
    }

    if (req.method === 'GET' && requestPath === '/api/events') {
	  if (!requireBearer(req, res, userBearerToken, 'Audience')) return;
      if (!publishingEnabled) return sendJson(res, 503, { error: 'Reaction publishing is disabled.' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      eventClients.add(res);
      req.on('close', () => eventClients.delete(res));
      return;
    }

	if (req.method === 'GET' && requestPath === '/api/admin/status') {
		if (!requireBearer(req, res, adminBearerToken, 'Admin')) return;
		return sendJson(res, 200, { publishingEnabled, serviceNuked, eventConnections: eventClients.size });
	}

	if (req.method === 'POST' && requestPath === '/api/admin/publishing') {
		if (!requireBearer(req, res, adminBearerToken, 'Admin')) return;
		const body = await readBody(req);
		const nextPublishingEnabled = Boolean(body.enabled);
		if (nextPublishingEnabled)
			pendingReactions.length = 0;
		publishingEnabled = nextPublishingEnabled;
		if (publishingEnabled)
			serviceNuked = false;
		if (!publishingEnabled) {
			pendingReactions.length = 0;
			closeEventClients();
		}
		return sendJson(res, 200, { publishingEnabled, serviceNuked, eventConnections: eventClients.size });
	}

	if (req.method === 'POST' && requestPath === '/api/admin/expire-sessions') {
		if (!requireBearer(req, res, adminBearerToken, 'Admin')) return;
		sessions.clear();
		return sendJson(res, 200, { ok: true });
	}

	if (req.method === 'POST' && requestPath === '/api/admin/nuke') {
		if (!requireBearer(req, res, adminBearerToken, 'Admin')) return;
		serviceNuked = true;
		publishingEnabled = false;
		pendingReactions.length = 0;
		sessions.clear();
		closeEventClients();
		return sendJson(res, 200, { publishingEnabled, serviceNuked, eventConnections: eventClients.size });
	}

	if (req.method === 'POST' && requestPath === '/api/admin/revoke-eula') {
		if (!requireBearer(req, res, adminBearerToken, 'Admin')) return;
		requiredEulaVersion += 1;
		sessions.clear();
		return sendJson(res, 200, { ok: true, eulaVersion: requiredEulaVersion });
	}

    if (req.method === 'GET' && requestPath === '/backend') {
	  if (!requireBearer(req, res, userBearerToken, 'Audience')) return;
	  if (!publishingEnabled) return sendJson(res, 503, { error: 'Reaction publishing is disabled.' });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(reactions, null, 2));
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: 'Something went wrong.' });
  }
});

server.listen(port, () => console.log(`Reaction room running at http://localhost:${port}`));
