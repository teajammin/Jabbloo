"""
Background removal, as a small local service.

Wraps rembg's model in about sixty lines of the standard library rather than
using the FastAPI server rembg ships with, for a plain reason: that server
accepts a multipart upload and never answers it on Python 3.14 — the request
does not even reach the application. Inference itself is fine, so the web layer
is the part worth replacing.

It also means the protocol is ours: raw image bytes in, PNG bytes out, no
multipart encoding to go wrong on either side.

    python scripts/cutout-server.py [port]

The model is loaded once at startup, so the first player to cut out a photo
waits no longer than the last.
"""

import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from rembg import new_session, remove

PORT = int(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("CUTOUT_PORT", 8788))
MODEL = "u2net"
# A phone photo is downscaled before it is sent; this is headroom, not a target.
MAX_BYTES = 12 * 1024 * 1024

session = None


class Handler(BaseHTTPRequestHandler):
    # The default logs one line per request to stderr with a timestamp format
    # that fights with the rest of `npm run dev`.
    def log_message(self, fmt, *args):
        sys.stderr.write(f"[cutout] {fmt % args}\n")

    def _send(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/") in ("/health", ""):
            self._send(200, b'{"ok":true,"model":"' + MODEL.encode() + b'"}', "application/json")
        else:
            self._send(404, b'{"error":"not found"}', "application/json")

    def do_POST(self):
        if self.path.rstrip("/") != "/cutout":
            self._send(404, b'{"error":"not found"}', "application/json")
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            self._send(400, b'{"error":"empty body"}', "application/json")
            return
        if length > MAX_BYTES:
            self._send(413, b'{"error":"image too large"}', "application/json")
            return

        data = self.rfile.read(length)
        try:
            self._send(200, remove(data, session=session), "image/png")
        except Exception as error:  # noqa: BLE001 - report, never crash the service
            sys.stderr.write(f"[cutout] failed: {error}\n")
            self._send(500, b'{"error":"could not process that image"}', "application/json")


if __name__ == "__main__":
    # The socket is claimed before the model is loaded: loading takes several
    # seconds, and finding out only afterwards that the port was taken wastes
    # all of them.
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError as error:
        sys.stderr.write(
            f"[cutout] port {PORT} is not available ({error.strerror}). "
            "Another cutout server is probably already running; "
            "the game will use it.\n"
        )
        # Not a failure worth taking down the dev stack for: whatever holds the
        # port is almost certainly this same service.
        sys.exit(0)

    sys.stderr.write(f"[cutout] loading {MODEL}...\n")
    session = new_session(MODEL)
    sys.stderr.write(f"[cutout] ready on http://127.0.0.1:{PORT}\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("[cutout] stopped\n")
