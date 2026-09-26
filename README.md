# Reaction Room

A small real-time audience reaction prototype.

## Run locally

Requires Node.js 20.12 or newer. Copy `.env.example` to `.env` and set both tokens before starting.

```sh
npm start
```

Open the audience access URL with the token in its query string:

```text
http://localhost:3000/?bearer=<USER_BEAR value from .env>
```

Open the presenter view with the same audience token and `presenter=1`. Open the admin panel with the admin token from `.env`:

```text
http://localhost:3000/?presenter=1&bearer=<USER_BEAR value from .env>
http://localhost:3000/admin.html?bearer=<ADMIN_BEAR value from .env>
```

## Access tokens

The server reads `USER_BEAR` and `ADMIN_BEAR` bearer tokens from `.env` at startup:

- `USER_BEAR` authenticates audience users, the presenter feed, and audience data endpoints through the `?bearer=` query parameter.
- `ADMIN_BEAR` authenticates the admin panel through the `?bearer=` query parameter.

Use standard environment variable assignments in `.env`:

```dotenv
USER_BEAR="your-audience-token"
ADMIN_BEAR="your-admin-token"
```

The server loads `.env` from the project directory at startup. Variables already set in the host environment take precedence. `.env` is ignored by Git; `.env.example` contains blank placeholders. Set each token to a separate random value and restart the server to rotate it. Missing tokens disable access for the corresponding role. Legacy `.token` and `.tokens` files are no longer read.

## Behavior

- A name starts a temporary session and is only a cosmetic display label. Names do not need to be unique and are not credentials.
- EULA consent is required before sending reactions. Consent is stored as the required version in the browser’s `eula_agreed` cookie; `Revoke EULA` increments that version and expires all temporary sessions.
- Reactions are delivered to connected event consumers in 150 ms Server-Sent Event batches; each event retains the sender’s cosmetic display name.
- Audience and presenter emoji visuals use Twemoji SVG images so they do not depend on a local emoji font.
- The audience client silently caps sends at five reactions per rolling second. Extra clicks are ignored locally.
- Raw received reactions are available as JSON at `http://localhost:3000/backend` or `/api/reactions` while publishing is enabled.
- The admin page at `http://localhost:3000/admin.html` controls the generic publishing gate. When disabled, incoming reactions are silently acknowledged and dropped; no reaction records are returned or streamed outward.
- When publishing is disabled without using `Nuke It`, audience and presenter views show a temporary “Stay Tuned!” message and automatically recover when publishing resumes.
- The admin page requires the `ADMIN_BEAR` bearer token from `.env`; audience and presenter access require the `USER_BEAR` bearer token from `.env`. The UI does not ask for tokens; access links must include them.
- The admin page’s `Expire Session` control invalidates all temporary audience sessions. Active audience clients detect this and reload; their EULA cookie is preserved.
- The admin page’s `Nuke It` control disables publishing, expires all temporary sessions, and shows audience clients a full-screen offline message. Turning publishing back on clears that offline state.
- An initial native OBS source plugin scaffold lives in [`obs/`](obs/), including the live SSE consumer and configurable particle source. It consumes the generic `/api/events` feed; the API does not identify or depend on that consumer.

Sessions and reaction history are held in memory, so restarting the server clears the server-side state.

## Cloud deployment

Set `USER_BEAR` and `ADMIN_BEAR` in the platform's environment settings (enter raw values without surrounding quotes). No `.env` file is required on the host. Keep the platform-provided `PORT`; the server binds to `0.0.0.0` on that port. Missing or invalid ports default to 3000; invalid values produce a warning. The accepted range is 1–65535.

Local `.env` loading is optional: missing or unreadable files do not stop startup, and runtimes without the built-in loader can use injected variables. Use Node.js 20.12+ as specified in `package.json`. Missing or blank tokens produce a warning and disable the corresponding protected endpoints with HTTP 503. Surrounding token whitespace is removed. Token values are never logged.

Listener errors are logged and retried on the same port every 10 seconds. The app cannot serve requests until the bind succeeds; platform health checks can still restart an unavailable instance. Check deployment logs and port settings if retries continue.
