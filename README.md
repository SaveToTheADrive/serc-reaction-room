# Reaction Room

A small real-time audience reaction prototype.

## Run locally

Requires Node.js 18 or newer.

```sh
npm start
```

Open the audience access URL with the token in its query string:

```text
http://localhost:3000/?bearer=<USER value from .tokens>
```

Open the presenter view with the same audience token and `presenter=1`. Open the admin panel with the admin token from `.tokens`:

```text
http://localhost:3000/?presenter=1&bearer=<USER value from .tokens>
http://localhost:3000/admin.html?bearer=<ADMIN value from .tokens>
```

## Access tokens

The server reads `USER` and `ADMIN` bearer tokens from `.tokens` at startup:

- `USER` authenticates audience users, the presenter feed, and audience data endpoints through the `?bearer=` query parameter.
- `ADMIN` authenticates the admin panel through the `?bearer=` query parameter.

Both files contain one locally generated token and are ignored by Git. The working copy includes generated tokens; replace either file with a new random value and restart the server to rotate it.

## Behavior

- A name starts a temporary session and is only a cosmetic display label. Names do not need to be unique and are not credentials.
- EULA consent is required before sending reactions. Consent is stored as the required version in the browser’s `eula_agreed` cookie; `Revoke EULA` increments that version and expires all temporary sessions.
- Reactions are delivered to connected event consumers in 150 ms Server-Sent Event batches; each event retains the sender’s cosmetic display name.
- Audience and presenter emoji visuals use Twemoji SVG images so they do not depend on a local emoji font.
- The audience client silently caps sends at five reactions per rolling second. Extra clicks are ignored locally.
- Raw received reactions are available as JSON at `http://localhost:3000/backend` or `/api/reactions` while publishing is enabled.
- The admin page at `http://localhost:3000/admin.html` controls the generic publishing gate. When disabled, incoming reactions are silently acknowledged and dropped; no reaction records are returned or streamed outward.
- When publishing is disabled without using `Nuke It`, audience and presenter views show a temporary “Stay Tuned!” message and automatically recover when publishing resumes.
- The admin page requires the `ADMIN` bearer token from `.tokens`; audience and presenter access require the `USER` bearer token from `.tokens`. The UI does not ask for tokens; access links must include them.
- The admin page’s `Expire Session` control invalidates all temporary audience sessions. Active audience clients detect this and reload; their EULA cookie is preserved.
- The admin page’s `Nuke It` control disables publishing, expires all temporary sessions, and shows audience clients a full-screen offline message. Turning publishing back on clears that offline state.
- An initial native OBS source plugin scaffold lives in [`obs/`](obs/), including the live SSE consumer and configurable particle source. It consumes the generic `/api/events` feed; the API does not identify or depend on that consumer.

Sessions and reaction history are held in memory, so restarting the server clears the server-side state.
