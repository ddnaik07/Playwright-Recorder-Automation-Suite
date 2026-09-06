"""
Local WebSocket bridge server. Lets the Chrome extension stream a recording
session live to the desktop app. Bound to 127.0.0.1 only, with a simple
shared-secret token handshake (see docs/PROTOCOL.md).

Runs inside its own QThread (with its own asyncio event loop) so the Qt GUI
thread is never blocked; results are surfaced to the GUI via thread-safe Qt
signals (PySide6 auto-marshals Signal emissions across threads).
"""
from __future__ import annotations

import asyncio
import json

from PySide6.QtCore import QThread, Signal


class BridgeServer(QThread):
    step_received = Signal(dict)
    session_event = Signal(str, dict)  # (message type, full message dict)
    client_connected = Signal(str)
    client_disconnected = Signal(str)
    log = Signal(str)
    server_error = Signal(str)

    def __init__(self, host: str = "127.0.0.1", port: int = 8765, token: str = "change-me-shared-secret", parent=None):
        super().__init__(parent)
        self.host = host
        self.port = port
        self.token = token
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stop_event: asyncio.Event | None = None
        self._authed_clients: set[str] = set()

    # -- QThread entry point -------------------------------------------------
    def run(self):
        local_hosts = {"127.0.0.1", "localhost", "::1", "::ffff:127.0.0.1"}
        if self.host.lower() not in local_hosts:
            self.server_error.emit(
                "Bridge server must bind to a loopback host (127.0.0.1, localhost or ::1), not a public interface."
            )
            return
        try:
            import websockets  # imported lazily so the GUI can start without it installed
        except ImportError:
            self.server_error.emit("The 'websockets' package is not installed. Run: pip install websockets")
            return

        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._stop_event = asyncio.Event()
        try:
            self._loop.run_until_complete(self._serve(websockets))
        except OSError as e:
            self.server_error.emit(f"Could not bind ws://{self.host}:{self.port} - {e}")
        except Exception as e:  # pragma: no cover - defensive
            self.server_error.emit(f"Bridge server error: {e}")
        finally:
            self._loop.close()

    async def _serve(self, websockets_module):
        async with websockets_module.serve(self._handle_client, self.host, self.port):
            self.log.emit(f"Bridge server listening on ws://{self.host}:{self.port}")
            await self._stop_event.wait()
            self.log.emit("Bridge server stopped")

    async def _handle_client(self, websocket, *_path_arg):
        client_id = str(id(websocket))
        authed = False
        try:
            async for raw in websocket:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                mtype = msg.get("type")

                if mtype == "session.start" and not authed:
                    if msg.get("token") == self.token:
                        authed = True
                        self._authed_clients.add(client_id)
                        await websocket.send(json.dumps({"type": "auth.ok", "sessionId": msg.get("sessionId")}))
                        self.client_connected.emit(client_id)
                        self.session_event.emit("session.start", msg)
                    else:
                        await websocket.send(json.dumps({"type": "auth.error", "reason": "invalid token"}))
                        await websocket.close()
                        return
                    continue

                if not authed:
                    # Ignore all traffic until the handshake succeeds.
                    continue

                if mtype == "step.recorded":
                    self.step_received.emit(msg.get("step", {}))
                elif mtype in ("session.pause", "session.resume", "session.stop", "session.export"):
                    self.session_event.emit(mtype, msg)
        except Exception as e:  # pragma: no cover - defensive
            self.log.emit(f"Bridge client error: {e}")
        finally:
            self._authed_clients.discard(client_id)
            self.client_disconnected.emit(client_id)

    def stop(self):
        if self._loop and self._stop_event:
            self._loop.call_soon_threadsafe(self._stop_event.set)
