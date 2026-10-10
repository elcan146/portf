#!/usr/bin/env python3
"""
Production server for elcanismayilov.com

Serves the Vite build (dist/) over HTTP and exposes it publicly through a
Cloudflare Tunnel, which handles the TLS certificate automatically.

Usage:
    python serve.py                  # serve dist/ on :8000 + start cloudflared
    python serve.py --port 8080      # custom port
    python serve.py --build          # run "npm run build" first
    python serve.py --no-tunnel      # serve locally only (no cloudflared)

cloudflared tunnel selection order:
    1. TUNNEL_TOKEN env var  -> "cloudflared tunnel run --token $TUNNEL_TOKEN"
       (recommended on AWS: create the tunnel + public hostname for
        elcanismayilov.com in the Cloudflare Zero Trust dashboard, copy the
        token, no other config needed on the server)
    2. TUNNEL_ID env var     -> "cloudflared tunnel run $TUNNEL_ID"
       (needs ~/.cloudflared/config.yml + credentials JSON on the server)
    3. cloudflared.yml next to this file with "tunnel:" + "credentials-file:"
    4. Otherwise -> free quick tunnel ("cloudflared tunnel --url http://localhost:PORT")
       prints a random https://*.trycloudflare.com URL. No fixed domain,
       dev/testing only.
"""

import argparse
import os
import re
import shlex
import shutil
import signal
import socket
import socketserver
import subprocess
import sys
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(ROOT, "dist")
CONFIG_YML = os.path.join(ROOT, "cloudflared.yml")
PHONE_UA = re.compile(
    r"iPhone|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile|Mobile.*Firefox|Android.*Mobile",
    re.I,
)


# ---------------------------------------------------------------------------
# Static file server
# ---------------------------------------------------------------------------

class SPARequestHandler(SimpleHTTPRequestHandler):
    """Serves dist/ with SPA fallback to index.html and cache headers."""

    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".glb": "model/gltf-binary",
        ".gltf": "model/gltf+json",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".mjs": "application/javascript",
        ".webmanifest": "application/manifest+json",
    }

    def log_message(self, fmt, *args):  # cleaner single-line logs
        sys.stderr.write("[http] %s - %s\n" % (self.address_string(), fmt % args))

    def end_headers(self):
        path = self.path.split("?", 1)[0]
        # Hashed assets under /assets can be cached forever; html stays fresh
        if path.startswith("/assets/"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        elif path.endswith((".html", "/")):
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Cache-Control", "public, max-age=3600")
        super().end_headers()

    def _wants_mobile(self, query: str) -> bool:
        # ?desktop=1 or the remembered opt-out cookie keeps the 3D site
        if re.search(r"(^|&)desktop=1(&|$)", query):
            return False
        if "viewMode=desktop" in (self.headers.get("Cookie") or ""):
            return False
        if self.headers.get("Sec-CH-UA-Mobile") == "?1":
            return True
        return bool(PHONE_UA.search(self.headers.get("User-Agent") or ""))

    def send_head(self):
        raw_path, _, query = self.path.partition("?")
        host = (self.headers.get("Host") or "").lower()
        if raw_path in ("/", "/index.html"):
            # m.<domain> serves the mobile layout at its root
            if host.startswith("m."):
                self.path = "/m/index.html"
            # Phones are redirected before any desktop bytes are sent
            elif self._wants_mobile(query):
                self.send_response(302)
                self.send_header("Location", "/m/")
                self.send_header("Vary", "User-Agent, Cookie")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return None
        # SPA fallback: extensionless paths that don't map to a file -> index.html
        path = self.translate_path(self.path)
        if not os.path.exists(path) and "." not in os.path.basename(self.path.split("?", 1)[0]):
            self.path = "/index.html"
        return super().send_head()


class ThreadedHTTPServer(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address):
        # Browsers abort video/GLB streams all the time - don't spam tracebacks
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def start_http(port: int) -> ThreadedHTTPServer:
    if not os.path.isdir(DIST_DIR):
        sys.exit(
            f"[serve] {DIST_DIR} not found. Run `npm run build` first "
            f"(or `python serve.py --build`)."
        )
    handler = partial(SPARequestHandler, directory=DIST_DIR)
    server = ThreadedHTTPServer(("0.0.0.0", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    host = socket.gethostname()
    print(f"[serve] Serving {DIST_DIR} on http://0.0.0.0:{port} ({host})")
    return server


# ---------------------------------------------------------------------------
# cloudflared
# ---------------------------------------------------------------------------

def cloudflared_cmd(port: int) -> list:
    token = os.environ.get("TUNNEL_TOKEN", "").strip()
    if token:
        return ["cloudflared", "tunnel", "run", "--token", token]

    tunnel_id = os.environ.get("TUNNEL_ID", "").strip()
    if tunnel_id:
        return ["cloudflared", "tunnel", "run", tunnel_id]

    if os.path.exists(CONFIG_YML):
        return ["cloudflared", "tunnel", "--config", CONFIG_YML, "run"]

    # Fallback: quick tunnel (random trycloudflare.com URL, dev only)
    print("[tunnel] No TUNNEL_TOKEN / TUNNEL_ID / cloudflared.yml -> starting a "
          "QUICK tunnel (random *.trycloudflare.com URL, not elcanismayilov.com)")
    return ["cloudflared", "tunnel", "--url", f"http://localhost:{port}"]


def run_tunnel(port: int):
    if shutil.which("cloudflared") is None:
        print("[tunnel] cloudflared not installed - site is only reachable locally.\n"
              "         Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/")
        return

    cmd = cloudflared_cmd(port)
    print(f"[tunnel] Starting: {' '.join(shlex.quote(c) for c in cmd)}")

    backoff = 2
    while True:
        proc = subprocess.Popen(cmd)
        ret = proc.wait()
        print(f"[tunnel] cloudflared exited (code {ret}), restarting in {backoff}s...")
        time.sleep(backoff)
        backoff = min(backoff * 2, 60)


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Serve portfolio + Cloudflare tunnel")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)))
    ap.add_argument("--build", action="store_true", help="run `npm run build` first")
    ap.add_argument("--no-tunnel", action="store_true", help="skip cloudflared")
    args = ap.parse_args()

    if args.build:
        subprocess.check_call(["npm", "run", "build"], cwd=ROOT, shell=os.name == "nt")

    server = start_http(args.port)

    tunnel_thread = None
    if not args.no_tunnel:
        tunnel_thread = threading.Thread(target=run_tunnel, args=(args.port,), daemon=True)
        tunnel_thread.start()

    def shutdown(*_):
        print("\n[serve] Shutting down...")
        server.shutdown()

    if os.name != "nt":
        signal.signal(signal.SIGTERM, shutdown)

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        shutdown()


if __name__ == "__main__":
    main()
