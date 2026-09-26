# Reaction Room

A small real-time audience reaction prototype.

## Run locally

Requires Node.js 20.12 or newer.

```sh
npm start
```

Open the audience access URL with the token in its query string:

```text
http://localhost:3000/?bearer=<userBearerToken value from server.js>
```

Open the presenter view with the same audience token and `presenter=1`. Open the admin panel with the admin token in `server.js`:

```text
http://localhost:3000/?presenter=1&bearer=<userBearerToken value from server.js>
http://localhost:3000/admin.html?bearer=<adminBearerToken value from server.js>
```

## Access tokens

The audience and admin bearer tokens are fixed constants in `server.js` (`userBearerToken` and `adminBearerToken`). Environment variables and local token files do not override them. Access links must include the corresponding token as `?bearer=...`; existing QR codes retain their token values.

To rotate a token, edit its server constant and redeploy. These values are now part of the server source.

## Behavior

- A name starts a temporary session and is only a cosmetic display label. Names do not need to be unique and are not credentials.
- EULA consent is required before sending reactions. Consent is stored as the required version in the browser’s `eula_agreed` cookie; `Revoke EULA` increments that version and expires all temporary sessions.
- Reactions are delivered to connected event consumers in 150 ms Server-Sent Event batches; each event retains the sender’s cosmetic display name.
- Audience and presenter emoji visuals use Twemoji SVG images so they do not depend on a local emoji font.
- The audience client silently caps sends at five reactions per rolling second. Extra clicks are ignored locally.
- Raw received reactions are available as JSON at `http://localhost:3000/backend` or `/api/reactions` while publishing is enabled.
- The admin page at `http://localhost:3000/admin.html` controls the generic publishing gate. When disabled, incoming reactions are silently acknowledged and dropped; no reaction records are returned or streamed outward.
- When publishing is disabled without using `Nuke It`, audience and presenter views show a temporary “Stay Tuned!” message and automatically recover when publishing resumes.
- The admin page requires the `adminBearerToken` constant in `server.js`; audience and presenter access require the `userBearerToken` constant in `server.js`. The UI does not ask for tokens; access links must include them.
- The admin page’s `Expire Session` control invalidates all temporary audience sessions. Active audience clients detect this and reload; their EULA cookie is preserved.
- The admin page’s `Nuke It` control disables publishing, expires all temporary sessions, and shows audience clients a full-screen offline message. Turning publishing back on clears that offline state.
- An initial native OBS source plugin scaffold lives in [`obs/`](obs/), including the live SSE consumer and configurable particle source. It consumes the generic `/api/events` feed; the API does not identify or depend on that consumer.

Sessions and reaction history are held in memory, so restarting the server clears the server-side state.

## Cloud deployment

No token environment variables are required. Keep the platform-provided `PORT`; the server binds to `0.0.0.0` on that port. Missing or invalid ports default to 3000; invalid values produce a warning. The accepted range is 1–65535.

Local `.env` loading remains optional for settings such as `PORT`. Use Node.js 20.12+ as specified in `package.json`.

Listener errors are logged and retried on the same port every 10 seconds. The app cannot serve requests until the bind succeeds; platform health checks can still restart an unavailable instance. Check deployment logs and port settings if retries continue.
