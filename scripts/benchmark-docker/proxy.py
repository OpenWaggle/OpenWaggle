#!/usr/bin/env python3
"""Logging reverse proxy in front of OpenRouter for the first-turn token benchmark.

Forwards every request to https://openrouter.ai with the real key in place of the
agent's dummy one, streams the upstream status, headers and body back exactly once
(SSE clients see chunks as they arrive), and appends one JSONL record per request:
the upstream status, the request body (agents' requests carry no credentials; the
Authorization header is never logged) and every usage object in the response.

The listener binds to 127.0.0.1 unless BENCH_PROXY_BIND names another local address
(run.sh passes Docker's bridge gateway on Linux). It injects a real key, so it must
never listen on every interface.

Usage: proxy.py <port> <openrouter-api-key> <log-path>
"""
import http.client
import json
import os
import ssl
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

PORT = int(sys.argv[1])
KEY = sys.argv[2]
LOG_PATH = sys.argv[3]
BIND = os.environ.get("BENCH_PROXY_BIND", "127.0.0.1")
# Overridable only so the proxy's tests can stand in a local upstream.
UPSTREAM = urlsplit(os.environ.get("BENCH_PROXY_UPSTREAM", "https://openrouter.ai"))
UPSTREAM_TIMEOUT_SECONDS = 600
CHUNK_BYTES = 4096
FORWARDED_RESPONSE_HEADERS = {"content-type", "cache-control"}
USAGE_KEYS = {"prompt_tokens", "input_tokens", "completion_tokens", "output_tokens", "total_tokens"}
# python.org builds ship without a CA bundle; fall back to the system one (macOS, most Linux).
SYSTEM_CA_FILES = ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt")
log_lock = threading.Lock()


def tls_context():
    cafile = os.environ.get("SSL_CERT_FILE") or next((path for path in SYSTEM_CA_FILES if os.path.exists(path)), None)
    return ssl.create_default_context(cafile=cafile)


def log(record):
    with log_lock:
        with open(LOG_PATH, "a") as handle:
            handle.write(json.dumps(record) + "\n")


def collect_usage(node, found):
    if isinstance(node, dict):
        if set(node.keys()) & USAGE_KEYS:
            found.append(node)
        for value in node.values():
            collect_usage(value, found)
    elif isinstance(node, list):
        for item in node:
            collect_usage(item, found)
    return found


def usage_of(payload):
    """Usage objects of an SSE stream or of a plain JSON response."""
    found = []
    text = payload.decode("utf-8", errors="replace")
    for line in text.split("\n"):
        line = line.strip()
        if line.startswith("data: ") and line != "data: [DONE]":
            try:
                collect_usage(json.loads(line[len("data: "):]), found)
            except ValueError:
                continue
    if not found:
        try:
            collect_usage(json.loads(text), found)
        except ValueError:
            pass
    return found


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _forward(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if length else None
        if UPSTREAM.scheme == "https":
            upstream = http.client.HTTPSConnection(UPSTREAM.netloc, timeout=UPSTREAM_TIMEOUT_SECONDS, context=tls_context())
        else:
            upstream = http.client.HTTPConnection(UPSTREAM.netloc, timeout=UPSTREAM_TIMEOUT_SECONDS)
        headers = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
        upstream.request(self.command, self.path, body=body, headers=headers)
        response = upstream.getresponse()

        self.send_response(response.status)
        for name, value in response.getheaders():
            if name.lower() in FORWARDED_RESPONSE_HEADERS:
                self.send_header(name, value)
        # No Content-Length: the body is relayed as it arrives and the connection closes.
        self.send_header("Connection", "close")
        self.end_headers()

        chunks = []
        client_open = True
        while True:
            chunk = response.read1(CHUNK_BYTES)
            if not chunk:
                break
            chunks.append(chunk)
            if client_open:
                try:
                    self.wfile.write(chunk)
                    self.wfile.flush()
                except BrokenPipeError:
                    client_open = False
        upstream.close()
        self.close_connection = True
        return body, response.status, b"".join(chunks)

    def _run(self):
        body, status, payload = self._forward()
        if body is None:
            return
        try:
            request = json.loads(body)
        except ValueError:
            request = None
        log({
            "command": self.command,
            "path": self.path,
            "status": status,
            "model": request.get("model") if isinstance(request, dict) else None,
            "request_bytes": len(body),
            "request": request,
            "usage_events": usage_of(payload),
        })

    def do_POST(self):
        self._run()

    def do_GET(self):
        self._run()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()
