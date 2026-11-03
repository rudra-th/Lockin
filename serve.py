#!/usr/bin/env python3
"""
Tiny static server for Lockin.

    python serve.py [port] [root]

`root` defaults to `app/`, the web surface. Pass `.` to serve the repo root
(for example while checking docs or the extension page).

Service workers require a secure context — http://localhost counts as one,
so this is enough to exercise the full PWA behaviour (install prompt,
offline caching, notifications, wake lock).
"""

import http.server
import socketserver
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
REPO = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(REPO, "app")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
        ".png": "image/png",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # Never cache during development; the service worker owns real caching.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Service-Worker-Allowed", "/")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


class Server(socketserver.ThreadingTCPServer):
    # The browser opens several connections at once — a single-threaded server
    # makes the page wait for one asset at a time.
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    with Server(("", PORT), Handler) as httpd:
        # ASCII only: Windows consoles (cp1252) crash on fancy glyphs in print()
        print("\n  Lockin -> http://localhost:{0}\n  Ctrl+C to stop\n".format(PORT))
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  stopped\n")
