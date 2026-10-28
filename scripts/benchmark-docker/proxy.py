#!/usr/bin/env python3
"""Logging reverse proxy in front of OpenRouter for the first-turn token benchmark.

Forwards the benchmark's model requests to https://openrouter.ai with the real key in
place of the agent's per-run token, streams the upstream status, headers and body back
exactly once (SSE clients see chunks as they arrive), and appends one JSONL record per
request: the upstream status, the request body (agents' requests carry no credentials;
the Authorization header is never logged) and every usage object in the response.
Records are appended when a response ends; each carries `seq`, the request's arrival
order, which readers sort by to find an agent's first request.

The listener binds to 127.0.0.1 unless BENCH_PROXY_BIND names another local address
(run.sh passes Docker's bridge gateway on Linux). Binding alone does not isolate it:
every container on the machine can reach host loopback (Docker Desktop) or the bridge
gateway (Linux). So the proxy also
- reads the real key from its environment (OPENROUTER_API_KEY), never from argv, which
  other local users can read;
- refuses (403) any request that does not present the per-run token BENCH_PROXY_TOKEN
  as `Authorization: Bearer <token>` or `x-api-key: <token>`;
- forwards only the model endpoints the agents use and only the model BENCH_MODEL.
`GET /__bench/ready` answers locally, so a readiness check never reaches OpenRouter.

Usage: OPENROUTER_API_KEY=... BENCH_PROXY_TOKEN=... BENCH_MODEL=... proxy.py <port> <log-path>
"""
import hmac
import http.client
import json
import os
import ssl
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

PORT = int(sys.argv[1])
LOG_PATH = sys.argv[2]
KEY = os.environ.get("OPENROUTER_API_KEY", "")
RUN_TOKEN = os.environ.get("BENCH_PROXY_TOKEN", "")
MODEL = os.environ.get("BENCH_MODEL", "")
BIND = os.environ.get("BENCH_PROXY_BIND", "127.0.0.1")
# Overridable only so the proxy's tests can stand in a local upstream.
UPSTREAM = urlsplit(os.environ.get("BENCH_PROXY_UPSTREAM", "https://openrouter.ai"))
UPSTREAM_TIMEOUT_SECONDS = 600
CHUNK_BYTES = 4096
FORWARDED_RESPONSE_HEADERS = {"content-type", "cache-control"}
USAGE_KEYS = {"prompt_tokens", "input_tokens", "completion_tokens", "output_tokens", "total_tokens"}
# python.org builds ship without a CA bundle; fall back to the system one (macOS, most Linux).
SYSTEM_CA_FILES = ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt")
READY_PATH = "/__bench/ready"
# The endpoints the benchmarked agents call (chat completions, responses, messages) and the
# model list some of them read. Anything else, `/api/v1/key` included, is refused.
ALLOWED_ROUTES = {
    ("POST", "/api/v1/chat/completions"),
    ("POST", "/api/v1/responses"),
    ("POST", "/api/v1/messages"),
    ("GET", "/api/v1/models"),
}
HTTP_NO_CONTENT = 204
HTTP_FORBIDDEN = 403
log_lock = threading.Lock()
arrival_lock = threading.Lock()
arrivals = 0


def next_arrival():
    """Arrival order of the requests: the log is written in completion order, and a short
    background call (a Session title) can finish before the first model call it overlaps."""
    global arrivals
    with arrival_lock:
        arrivals += 1
        return arrivals


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


AGENT_PREFIX = "/agent/"


def split_agent_path(path):
    """`/agent/<name>/rest` -> (name, `/rest`): each agent's base URL names it, so a request
    that finishes after its agent exited (a background title call) is still that agent's."""
    if not path.startswith(AGENT_PREFIX):
        return None, path
    name, _, rest = path[len(AGENT_PREFIX):].partition("/")
    return (name or None), "/" + rest


def presented_token(headers):
    authorization = headers.get("Authorization") or ""
    if authorization.lower().startswith("bearer "):
        return authorization[len("bearer "):].strip()
    return (headers.get("x-api-key") or "").strip()


def refusal(command, upstream_path, headers, body):
    """Why a request must not reach OpenRouter, or None when it may."""
    if not hmac.compare_digest(presented_token(headers).encode(), RUN_TOKEN.encode()):
        return "missing or wrong run token"
    route = upstream_path.split("?", 1)[0]
    if (command, route) not in ALLOWED_ROUTES:
        return f"{command} {route} is not a benchmark endpoint"
    if command == "POST":
        try:
            model = json.loads(body or b"null").get("model")
        except (ValueError, AttributeError):
            return "the request body is not a JSON object"
        if model != MODEL:
            return f"model {model!r} is not the benchmark model"
    return None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _respond_locally(self, status, text=""):
        payload = text.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Connection", "close")
        self.end_headers()
        if payload:
            self.wfile.write(payload)
        self.close_connection = True

    def _forward(self, upstream_path, body):
        if UPSTREAM.scheme == "https":
            upstream = http.client.HTTPSConnection(UPSTREAM.netloc, timeout=UPSTREAM_TIMEOUT_SECONDS, context=tls_context())
        else:
            upstream = http.client.HTTPConnection(UPSTREAM.netloc, timeout=UPSTREAM_TIMEOUT_SECONDS)
        headers = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
        upstream.request(self.command, upstream_path, body=body, headers=headers)
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
        if self.path == READY_PATH:
            self._respond_locally(HTTP_NO_CONTENT)
            return
        seq = next_arrival()
        arrived_at = time.time()
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if length else None
        agent, upstream_path = split_agent_path(self.path)
        reason = refusal(self.command, upstream_path, self.headers, body)
        if reason:
            self._respond_locally(HTTP_FORBIDDEN, f"benchmark proxy: {reason}\n")
            return
        _, status, payload = self._forward(upstream_path, body)
        if body is None:
            return
        try:
            request = json.loads(body)
        except ValueError:
            request = None
        log({
            "seq": seq,
            "arrived_at": arrived_at,
            "command": self.command,
            "agent": agent,
            "path": upstream_path,
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
    if not KEY or not RUN_TOKEN or not MODEL:
        sys.exit("proxy.py: set OPENROUTER_API_KEY, BENCH_PROXY_TOKEN and BENCH_MODEL in its environment")
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()
