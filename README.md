# Ink WebSocket Chat

A minimal terminal chat host built with [Ink](https://github.com/vadimdemedes/ink). It starts a websocket server and gives you a two-pane TUI:

- left pane: sessions ordered by first connection time
- right pane: timestamped transcript plus a single-line chat input

## Run

```bash
npm install
npm run dev
```

Use a custom port:

```bash
npm run dev -- --port 9999
```

Build and run the compiled app:

```bash
npm run build
npm start -- --port 9999
```

## WebSocket Protocol

The server accepts simple JSON text messages:

```json
{ "message": "hello" }
```

Clients can optionally resume a prior in-memory session by supplying an id in the websocket URL:

```text
ws://localhost:8888/?id=my-client
```

If no id is supplied, the server generates one with `human-readable-ids`.

## Sample Browser Client

A self-contained sample page lives at `sample-client.html`.

1. Start the CLI:

```bash
npm run dev
```

2. Open `sample-client.html` in your browser.
3. Leave the default websocket URL as `ws://localhost:8888` or change it to match your `--port`.
4. Click `Connect` and start chatting.

The sample intentionally does not send a resume `id`, so each browser tab creates a brand new session in the TUI. Open multiple tabs if you want multiple simultaneous sessions.

## TUI Behavior

- sessions stay in memory after disconnect so transcript history remains visible
- reconnecting with the same `id` restores the old session and draft
- new or reconnected sessions show a blue dot until you focus that chat
- every transcript line shows a timestamp
- connect, reconnect, and disconnect events are recorded inline in the feed

## Keybindings

- `Up` / `Down`: move through sessions
- `Enter` from the left pane: focus the selected chat
- `Type`: edit the current draft in chat mode
- `Enter` from chat mode: send the current draft
- `Shift+Tab`: leave chat mode and return to the session list

When a session is disconnected, the chat pane shows `>>> DISCONNECTED <<<` and sending is disabled until that client reconnects.

## Checks

```bash
npm run build
npm test
```
# ws_tool
