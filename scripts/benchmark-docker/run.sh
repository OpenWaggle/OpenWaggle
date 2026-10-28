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
# The proxy injects the real key, so it never listens on every interface: loopback on Docker
# Desktop (macOS, Windows), which containers reach through host.docker.internal, and the bridge
# gateway on Linux. Every container on the machine can reach either address, so the proxy also
# requires a per-run token (the agents' API key) and forwards only the benchmark's endpoints and
# model; the real key reaches it through its environment, never its argv.
if [[ "$(uname -s)" == "Linux" && -z "${BENCH_PROXY_BIND:-}" ]]; then
  BENCH_PROXY_BIND="$(docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}')"
fi
export BENCH_PROXY_BIND="${BENCH_PROXY_BIND:-127.0.0.1}"

if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "error: set OPENROUTER_API_KEY (the proxy injects it; agents get a per-run token)" >&2
  exit 1
fi

if [[ "${BENCH_SKIP_BUILD:-}" != "1" ]]; then
  docker build -q -t "$IMAGE" "$SCRIPT_DIR"
fi

mkdir -p "$RESULTS_DIR"
# Clear ALL prior artifacts: a subset run must never blend with stale outputs.
rm -f "$RESULTS_DIR"/proxy-log.jsonl "$RESULTS_DIR"/proxy.out "$RESULTS_DIR"/results.json
rm -f "$RESULTS_DIR"/*.out "$RESULTS_DIR"/*.err "$RESULTS_DIR"/*.proxy.jsonl "$RESULTS_DIR"/request-tokens.json

# The agents' API key: only a request carrying it gets the real key injected.
BENCH_PROXY_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
export BENCH_PROXY_TOKEN BENCH_MODEL
OPENROUTER_API_KEY="$OPENROUTER_API_KEY" python3 "$SCRIPT_DIR/proxy.py" "$PROXY_PORT" \
  "$RESULTS_DIR/proxy-log.jsonl" > "$RESULTS_DIR/proxy.out" 2>&1 &
PROXY_PID=$!
# Nothing else this script starts (docker, the OpenWaggle row) needs the real key.
unset OPENROUTER_API_KEY
trap 'kill "$PROXY_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do
  if curl -s -o /dev/null "http://$BENCH_PROXY_BIND:$PROXY_PORT/__bench/ready"; then break; fi
  sleep 0.2
done
touch "$RESULTS_DIR/proxy-log.jsonl"

# Every agent's base URL carries its name (`/agent/<name>`), and the proxy records it, so each
# agent's slice is selected by name: a request still in flight when its agent exits (opencode's
# background title call) lands in its own slice, not the next agent's. The proxy writes its record
# after the response ends, so wait until the log has not grown for 10 s before slicing.
wait_for_quiet_proxy_log() {
  local stable=0 prev current
  prev=$(wc -l < "$RESULTS_DIR/proxy-log.jsonl")
  while [[ $stable -lt 20 ]]; do
    sleep 0.5
    current=$(wc -l < "$RESULTS_DIR/proxy-log.jsonl")
    if [[ "$current" -eq "$prev" ]]; then
      stable=$((stable + 1))
    else
      stable=0
      prev=$current
    fi
  done
}

slice_proxy_log() {
  local agent="$1"
  python3 - "$RESULTS_DIR/proxy-log.jsonl" "$agent" > "$RESULTS_DIR/$agent.proxy.jsonl" <<'PY'
import json, sys
for line in open(sys.argv[1]):
    if line.strip() and json.loads(line).get("agent") == sys.argv[2]:
        sys.stdout.write(line)
PY
}

requested=()
sliced=()
if [[ $# -gt 0 ]]; then requested=("$@"); else requested=("${AGENTS[@]}"); fi

for agent in "${requested[@]}"; do
  echo "=== $agent ==="
  docker run --rm \
    --add-host=host.docker.internal:host-gateway \
    -e "BENCH_PROXY_URL=http://host.docker.internal:$PROXY_PORT/agent/$agent" \
    -e BENCH_PROXY_TOKEN \
    -v "$SCRIPT_DIR/inside.sh:/bench/inside.sh:ro" \
    -v "$RESULTS_DIR:/bench/out" \
    "$IMAGE" \
    bash /bench/inside.sh "$agent" > "$RESULTS_DIR/$agent.out" 2> "$RESULTS_DIR/$agent.err" \
    || echo "warning: $agent exited non-zero (see $RESULTS_DIR/$agent.err)" >&2
  sliced+=("$agent")
done

if [[ -n "${BENCH_OPENWAGGLE_APP:-}" ]]; then
  echo "=== openwaggle ==="
  (cd "$SCRIPT_DIR/../.." && pnpm -s exec tsx scripts/benchmark-docker/openwaggle-row.ts \
    --app "$BENCH_OPENWAGGLE_APP" --proxy "http://127.0.0.1:$PROXY_PORT/agent/openwaggle" --model "$BENCH_MODEL") \
    > "$RESULTS_DIR/openwaggle.out" 2> "$RESULTS_DIR/openwaggle.err" \
    || echo "warning: openwaggle exited non-zero (see $RESULTS_DIR/openwaggle.err)" >&2
  sliced+=(openwaggle)
fi

wait_for_quiet_proxy_log
for agent in ${sliced[@]+"${sliced[@]}"}; do slice_proxy_log "$agent"; done

(cd "$SCRIPT_DIR/../.." && pnpm -s exec tsx scripts/benchmark-docker/count-request-tokens.ts "$RESULTS_DIR") \
  || echo "warning: request token counting failed" >&2
python3 "$SCRIPT_DIR/parse-results.py" "$RESULTS_DIR"
