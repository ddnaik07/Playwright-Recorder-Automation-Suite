# Data Schema & Bridge Protocol

Shared contract between the Chrome extension (Part A) and the Python desktop
app (Part B).

## 1. Step schema (JSON)

Every recorded interaction is serialized as a single **Step** object:

```jsonc
{
  "id": "b3b9c9b0-6f1a-4a9e-9c2e-6b6f1a2b3c4d",   // uuid4
  "action": "click",                               // see Action enum below
  "selector": "#submit-btn",                        // human-meaningful selector value
  "selectorType": "id",                             // testid | id | role | css | xpath
  "cssEquivalent": "#submit-btn",                   // ready-to-use Playwright locator string
  "role": null,                                     // ARIA role, only set when selectorType == "role"
  "value": null,                                    // text typed / option value / checked state
  "url": "https://example.com/checkout",            // page URL at the time of the action
  "frameId": 0,                                     // 0 = top frame, -1 = unknown subframe
  "timestamp": 1732200000000,                       // epoch ms
  "screenshot": null,                               // optional data:image/jpeg;base64,... thumbnail
  "waitFor": { "type": "visible", "timeout": 5000 }, // wait strategy hint for the executor
  "meta": null                                       // action-specific extras (e.g. drag target)
}
```

### Action enum

| Action | Meaning | `value` |
|---|---|---|
| `navigate` | Full page navigation / initial URL | `null` |
| `click` | Mouse click on an element | `null` |
| `fill` | Text typed into an input/textarea (debounced) | final string |
| `select` | `<select>` value changed | selected option value |
| `check` / `uncheck` | Checkbox/radio toggled | boolean |
| `press` | Enter/Tab key press | `"Enter"` \| `"Tab"` |
| `hover` | Mouse hover (optional capture) | `null` |
| `dragdrop` | Drag-and-drop gesture | `null` (see `meta.targetSelector`) |
| `upload-click` / `upload` | File input interaction | comma-joined file names |

### `selectorType` priority

`testid` (data-testid/data-\*) → `id` → `role` (aria-role + accessible name /
visible text) → `css` (unique CSS path) → `xpath` (fallback).

## 2. WebSocket bridge protocol

- Server: the desktop app hosts a local-only WebSocket server, bound to
  `127.0.0.1` (never `0.0.0.0`), default `ws://127.0.0.1:8765`.
- Client: the Chrome extension's background service worker connects and
  performs a shared-secret handshake before the server accepts any session
  traffic.
- Transport: newline-free JSON text frames, one message per frame.

### Message envelope

```jsonc
{ "type": "<message.type>", "sessionId": "...", /* type-specific fields */ }
```

### Message types

| Type | Direction | Payload |
|---|---|---|
| `session.start` | ext → server | `{ token, sessionId, meta: { url, title, userAgent, extensionVersion } }` |
| `auth.ok` | server → ext | `{ sessionId }` — sent after the shared-secret token is verified |
| `auth.error` | server → ext | `{ reason }` — server closes the socket after sending this |
| `step.recorded` | ext → server | `{ sessionId, step: <Step> }` |
| `session.pause` | ext → server | `{ sessionId }` |
| `session.resume` | ext → server | `{ sessionId }` |
| `session.stop` | ext → server | `{ sessionId, summary: { stepCount, endedAt } }` |
| `session.export` | ext → server | `{ sessionId, format: "json" \| "playwright_python", payload }` (optional; the extension can also push a full export on demand) |

### Auth handshake

1. Extension opens the socket and immediately sends `session.start` with a
   `token` field.
2. Server compares `token` against its configured shared secret
   (constant-time compare). On success it replies `auth.ok`; all subsequent
   `step.recorded`/`session.*` messages for that connection are accepted.
3. On failure it replies `auth.error` and closes the connection. The
   extension popup reflects this as bridge status `error`.

### Trust & binding rules

- The bridge server **must** bind to `127.0.0.1`/`localhost` only — never a
  public interface — since there is no TLS and the token is a simple shared
  secret suitable for local trust between the extension and the desktop app
  running on the same machine.
- The token is configured in both the extension's Settings panel and the
  desktop app's Bridge Server settings; treat it like a local pairing code.

## 3. Project & report artifacts (desktop app)

- **Project file** (`*.pwproj.json`): `{ name, createdAt, scripts: [{ name, steps: Step[] }] }`
- **Run report** (`RunResult`): `{ runId, startedAt, endedAt, durationMs, steps: StepResult[] }`
  where each `StepResult` extends `Step` with `{ status, error, screenshotPath, tracePath, durationMs }`
  and `status` is one of `pending | running | passed | failed | skipped`.
