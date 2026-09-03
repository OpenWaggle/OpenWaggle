#!/usr/bin/env bash
# First-prompt token benchmark: runs every coding agent in a pristine container
# pinned to exact versions, with a fresh home, an empty project, no plugins,
# extensions, skills, MCP servers, or AGENTS.md files — all traffic through a
# local logging proxy that injects the real OpenRouter key.
#
# Usage:
#   OPENROUTER_API_KEY=sk-or-... ./run.sh            # all agents
#   OPENROUTER_API_KEY=sk-or-... ./run.sh pi084 claude
#
# Results land in scripts/benchmark-docker/results.json (plus raw outputs in
# results/). The proxy log has per-call prompt_tokens for every request.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
PROXY_PORT="${BENCH_PROXY_PORT:-8399}"
IMAGE="openwaggle-bench-agents:latest"
AGENTS=(pi081 pi084 claude codex opencode reasonix aider dsh)

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
rm -f "$RESULTS_DIR"/*.out "$RESULTS_DIR"/*.err "$RESULTS_DIR"/*.proxy.jsonl

python3 "$SCRIPT_DIR/proxy.py" "$PROXY_PORT" "$OPENROUTER_API_KEY" \
  "$RESULTS_DIR/proxy-log.jsonl" > "$RESULTS_DIR/proxy.out" 2>&1 &
PROXY_PID=$!
trap 'kill "$PROXY_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
  if curl -s -o /dev/null "http://127.0.0.1:$PROXY_PORT/api/v1/models"; then break; fi
  sleep 0.2
done
touch "$RESULTS_DIR/proxy-log.jsonl"

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
  # Snapshot the proxy log slice for this agent: per-call wire truth. The
  # proxy writes its record after the agent exits, so wait until the line
  # count stabilizes before slicing.
  stable=0
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
  after=$current
  tail -n "+$((before + 1))" "$RESULTS_DIR/proxy-log.jsonl" > "$RESULTS_DIR/$agent.proxy.jsonl"
done

python3 "$SCRIPT_DIR/parse-results.py" "$RESULTS_DIR"
