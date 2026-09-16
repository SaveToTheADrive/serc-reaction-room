# Reaction Room

A small real-time audience reaction prototype.

## Run locally

Requires Node.js 18 or newer.

```sh
npm start
```

Open `http://localhost:3000` for the audience view. Open `http://localhost:3000/?presenter=1` for the presenter view.

## Behavior

- A name starts a temporary session and is only a cosmetic display label. Names do not need to be unique and are not credentials.
- EULA consent is required before sending reactions. Consent is stored as the required version in the browser’s `eula_agreed` cookie; `Revoke EULA` increments that version and expires all temporary sessions.
- Reactions are delivered to connected event consumers in 150 ms Server-Sent Event batches; each event retains the sender’s cosmetic display name.
- Audience and presenter emoji visuals use Twemoji SVG images so they do not depend on a local emoji font.
- The audience client silently caps sends at five reactions per rolling second. Extra clicks are ignored locally.
- Raw received reactions are available as JSON at `http://localhost:3000/backend` or `/api/reactions` while publishing is enabled.
- The admin page at `http://localhost:3000/admin.html` controls the generic publishing gate. When disabled, incoming reactions are silently acknowledged and dropped; no reaction records are returned or streamed outward.
- The admin page’s `Expire Session` control invalidates all temporary audience sessions. Active audience clients detect this and reload; their EULA cookie is preserved.
- The admin page’s `Nuke It` control disables publishing, expires all temporary sessions, and shows audience clients a full-screen offline message. Turning publishing back on clears that offline state.
- An initial native OBS source plugin scaffold lives in [`obs/`](obs/), including the live SSE consumer and configurable particle source. It consumes the generic `/api/events` feed; the API does not identify or depend on that consumer.

Sessions and reaction history are held in memory, so restarting the server clears the server-side state.
