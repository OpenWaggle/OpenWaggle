#!/usr/bin/env bash
# First-prompt token benchmark: runs every coding agent in a pristine container
# pinned to exact versions, with a fresh home, an empty project, no plugins,
# extensions, skills, MCP servers, or AGENTS.md files — all traffic through a
# local logging proxy that injects the real OpenRouter key.
#
# Usage:
#   OPENROUTER_API_KEY=sk-or-... ./run.sh                 # pi, claude, codex, opencode
#   OPENROUTER_API_KEY=sk-or-... ./run.sh pi claude
#   BENCH_OPENWAGGLE_APP=/path/OpenWaggle.app OPENROUTER_API_KEY=... ./run.sh
#
# BENCH_OPENWAGGLE_APP adds the "openwaggle" row: the packaged app itself, on the host, in
# hidden automation with first-party extensions, through the same proxy and model.
#
# Results land in results/results.json (plus raw outputs in results/). The proxy log has
# every request body and the provider-reported usage of every call; request-tokens.json has
# the o200k count of each agent's first request (system prompt + tool declarations).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
PROXY_PORT="${BENCH_PROXY_PORT:-8399}"
IMAGE="openwaggle-bench-agents:latest"
BENCH_MODEL="z-ai/glm-5.3-flash"
AGENTS=(pi claude codex opencode)
# The proxy injects the real key, so it listens on loopback only. Docker Desktop (macOS,
# Windows) reaches host loopback through host.docker.internal; on Linux the containers use
# the bridge gateway, so the proxy binds there instead of on every interface.
if [[ "$(uname -s)" == "Linux" && -z "${BENCH_PROXY_BIND:-}" ]]; then
  BENCH_PROXY_BIND="$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')"
fi
export BENCH_PROXY_BIND="${BENCH_PROXY_BIND:-127.0.0.1}"

if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "error: set OPENROUTER_API_KEY (the proxy injects it; agents get a dummy key)" >&2
  exit 1
fi

if [[ "${BENCH_SKIP_BUILD:-}" != "1" ]]; then
  docker build -q -t "$IMAGE" "$SCRIPT_DIR"
fi

mkdir -p "$RESULTS_DIR"
# Clear ALL prior artifacts: a subset run must never blend with stale outputs.
rm -f "$RESULTS_DIR"/proxy-log.jsonl "$RESULTS_DIR"/proxy.out "$RESULTS_DIR"/results.json
rm -f "$RESULTS_DIR"/*.out "$RESULTS_DIR"/*.err "$RESULTS_DIR"/*.proxy.jsonl "$RESULTS_DIR"/request-tokens.json

python3 "$SCRIPT_DIR/proxy.py" "$PROXY_PORT" "$OPENROUTER_API_KEY" \
  "$RESULTS_DIR/proxy-log.jsonl" > "$RESULTS_DIR/proxy.out" 2>&1 &
PROXY_PID=$!
trap 'kill "$PROXY_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
  if curl -s -o /dev/null "http://127.0.0.1:$PROXY_PORT/api/v1/models"; then break; fi
  sleep 0.2
done
touch "$RESULTS_DIR/proxy-log.jsonl"

# Snapshot the proxy log slice for one agent: per-call wire truth. The proxy writes its record
# after the response ends, so wait until the line count stops changing before slicing.
slice_proxy_log() {
  local agent="$1" before="$2" stable=0 prev current
  prev=$(wc -l < "$RESULTS_DIR/proxy-log.jsonl")
  while [[ $stable -lt 2 ]]; do
    sleep 0.5
    current=$(wc -l < "$RESULTS_DIR/proxy-log.jsonl")
    if [[ "$current" -eq "$prev" ]]; then
      stable=$((stable + 1))
    else
      stable=0
      prev=$current
    fi
  done
  tail -n "+$((before + 1))" "$RESULTS_DIR/proxy-log.jsonl" > "$RESULTS_DIR/$agent.proxy.jsonl"
}

requested=()
if [[ $# -gt 0 ]]; then requested=("$@"); else requested=("${AGENTS[@]}"); fi

for agent in "${requested[@]}"; do
  echo "=== $agent ==="
  before=$(wc -l < "$RESULTS_DIR/proxy-log.jsonl")
  docker run --rm \
    --add-host=host.docker.internal:host-gateway \
    -e "BENCH_PROXY_URL=http://host.docker.internal:$PROXY_PORT" \
    -v "$SCRIPT_DIR/inside.sh:/bench/inside.sh:ro" \
    -v "$RESULTS_DIR:/bench/out" \
    "$IMAGE" \
    bash /bench/inside.sh "$agent" > "$RESULTS_DIR/$agent.out" 2> "$RESULTS_DIR/$agent.err" \
    || echo "warning: $agent exited non-zero (see $RESULTS_DIR/$agent.err)" >&2
  slice_proxy_log "$agent" "$before"
done

if [[ -n "${BENCH_OPENWAGGLE_APP:-}" ]]; then
  echo "=== openwaggle ==="
  before=$(wc -l < "$RESULTS_DIR/proxy-log.jsonl")
  (cd "$SCRIPT_DIR/../.." && pnpm -s exec tsx scripts/benchmark-docker/openwaggle-row.ts \
    --app "$BENCH_OPENWAGGLE_APP" --proxy "http://127.0.0.1:$PROXY_PORT" --model "$BENCH_MODEL") \
    > "$RESULTS_DIR/openwaggle.out" 2> "$RESULTS_DIR/openwaggle.err" \
    || echo "warning: openwaggle exited non-zero (see $RESULTS_DIR/openwaggle.err)" >&2
  slice_proxy_log openwaggle "$before"
fi

(cd "$SCRIPT_DIR/../.." && pnpm -s exec tsx scripts/benchmark-docker/count-request-tokens.ts "$RESULTS_DIR") \
  || echo "warning: request token counting failed" >&2
python3 "$SCRIPT_DIR/parse-results.py" "$RESULTS_DIR"
