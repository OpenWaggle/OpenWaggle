#!/usr/bin/env python3
"""Logging reverse proxy in front of OpenRouter.

Forwards every request to https://openrouter.ai, replacing the Authorization
header with the real key, while streaming the response back incrementally (so
SSE clients do not time out) and logging per-request usage to a JSONL file.

Usage: proxy.py <port> <openrouter-api-key> <log-path>
"""
import json
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1])
KEY = sys.argv[2]
LOG_PATH = sys.argv[3]
CURL_TIMEOUT_SECONDS = 600
log_lock = threading.Lock()


def log(record):
    with log_lock:
        with open(LOG_PATH, "a") as f:
            f.write(json.dumps(record) + "\n")


def collect_usage(node, found):
    if isinstance(node, dict):
        if set(node.keys()) & {
            "prompt_tokens",
            "input_tokens",
            "completion_tokens",
            "output_tokens",
            "total_tokens",
        }:
            found.append(node)
        for value in node.values():
            collect_usage(value, found)
    elif isinstance(node, list):
        for item in node:
            collect_usage(item, found)
    return found


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _run(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = self.rfile.read(length) if length else None

        # Bind 0.0.0.0 so Linux host-gateway clients can reach us; the real key
        # never leaves this process, and the port is only exposed locally.
        cmd = [
            "curl", "-s", "-N",
            f"--max-time", str(CURL_TIMEOUT_SECONDS),
            f"https://openrouter.ai{self.path}",
            "-H", f"Authorization: Bearer {KEY}",
            "-H", "Content-Type: application/json",
            "-X", self.command,
            "-w", "\n%{http_code}",
        ]
        if body is not None:
            cmd += ["--data-binary", "@-"]

        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        try:
            proc.stdin.write(body if body is not None else b"")
            proc.stdin.close()
        except BrokenPipeError:
            pass

        # Stream through as chunks arrive; the final line carries the status.
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

        chunks = []
        while True:
            chunk = proc.stdout.read(4096)
            if not chunk:
                break
            chunks.append(chunk)
            try:
                self.wfile.write(chunk)
                self.wfile.flush()
            except BrokenPipeError:
                break
        proc.wait()

        payload = b"".join(chunks)
        upstream_status = None
        last_newline = payload.rfind(b"\n")
        if last_newline >= 0:
            trailer = payload[last_newline + 1:].strip()
            if trailer.isdigit():
                upstream_status = int(trailer)
                payload = payload[:last_newline]
        try:
            self.wfile.write(payload)
            self.wfile.flush()
        except BrokenPipeError:
            pass

        if body is not None:
            usage_events = []
            model = None
            try:
                model = json.loads(body).get("model")
            except Exception:
                pass
            for line in payload.split(b"\n"):
                line = line.strip()
                if line.startswith(b"data: ") and line != b"data: [DONE]":
                    try:
                        event = json.loads(line[6:])
                    except Exception:
                        continue
                    if isinstance(event, dict):
                        collect_usage(event, usage_events)
            log({
                "command": self.command,
                "path": self.path,
                "status": upstream_status,
                "model": model,
                "request_bytes": len(body),
                "usage_events": usage_events,
            })

    def do_POST(self):
        self._run()

    def do_GET(self):
        self._run()

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()
