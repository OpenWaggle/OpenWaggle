#!/usr/bin/env bash
# Runs inside the benchmark container. Usage: inside.sh <agent>
# Every agent gets: fresh HOME, empty project, dummy API key, zero plugins,
# extensions, skills, MCP servers, or AGENTS.md files to discover.
set -euo pipefail

AGENT="$1"
PROBE="Reply with exactly OK and nothing else."
PROXY="${BENCH_PROXY_URL:-http://host.docker.internal:8399}"
MODEL="z-ai/glm-5.3-flash"
OUT=/bench/out

export HOME=/bench/home
mkdir -p "$HOME" /bench/project "$OUT"
cd /bench/project

case "$AGENT" in
  pi081)
    export PI_CODING_AGENT_DIR=/bench/pi-agent
    mkdir -p "$PI_CODING_AGENT_DIR"
    cat > "$PI_CODING_AGENT_DIR/models.json" <<EOF
{
  "providers": {
    "bench": {
      "name": "Bench OpenRouter",
      "baseUrl": "$PROXY/api/v1",
      "api": "openai-completions",
      "apiKey": "bench-proxy",
      "models": [
        {
          "id": "$MODEL",
          "name": "GLM 5.3 Flash",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 1000000,
          "maxTokens": 131072,
          "cost": { "input": 0.2, "output": 0.6, "cacheRead": 0.02, "cacheWrite": 0.08 }
        }
      ]
    }
  }
}
EOF
    echo '{"bench":{"type":"api_key","key":"bench-proxy"}}' > "$PI_CODING_AGENT_DIR/auth.json"
    exec pi -p --mode json --no-session \
      --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files \
      --model "bench/$MODEL" "$PROBE"
    ;;
  pi084)
    export PI_CODING_AGENT_DIR=/bench/pi-agent
    mkdir -p "$PI_CODING_AGENT_DIR"
    cat > "$PI_CODING_AGENT_DIR/models.json" <<EOF
{
  "providers": {
    "bench": {
      "name": "Bench OpenRouter",
      "baseUrl": "$PROXY/api/v1",
      "api": "openai-completions",
      "apiKey": "bench-proxy",
      "models": [
        {
          "id": "$MODEL",
          "name": "GLM 5.3 Flash",
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 1000000,
          "maxTokens": 131072,
          "cost": { "input": 0.2, "output": 0.6, "cacheRead": 0.02, "cacheWrite": 0.08 }
        }
      ]
    }
  }
}
EOF
    echo '{"bench":{"type":"api_key","key":"bench-proxy"}}' > "$PI_CODING_AGENT_DIR/auth.json"
    exec /opt/pi-latest/bin/pi -p --mode json --no-session \
      --no-extensions --no-skills --no-prompt-templates --no-themes --no-context-files \
      --model "bench/$MODEL" "$PROBE"
    ;;
  claude)
    export ANTHROPIC_BASE_URL="$PROXY/api"
    export ANTHROPIC_AUTH_TOKEN=bench-proxy
    export ANTHROPIC_MODEL="$MODEL"
    export ANTHROPIC_SMALL_FAST_MODEL="$MODEL"
    export DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1
    export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
    exec claude -p --output-format json --strict-mcp-config --disable-slash-commands "$PROBE"
    ;;
  codex)
    export CODEX_HOME=/bench/codex-home
    mkdir -p "$CODEX_HOME"
    cat > "$CODEX_HOME/config.toml" <<EOF
model = "$MODEL"
model_provider = "bench"
model_reasoning_effort = "low"

[model_providers.bench]
name = "Bench OpenRouter"
base_url = "$PROXY/api/v1"
env_key = "OPENROUTER_API_KEY"
wire_api = "responses"
EOF
    export OPENROUTER_API_KEY=bench-proxy
    exec codex exec --json --skip-git-repo-check "$PROBE" < /dev/null
    ;;
  opencode)
    export XDG_CONFIG_HOME=/bench/xdg
    export XDG_DATA_HOME=/bench/xdgdata
    export XDG_CACHE_HOME=/bench/xdgcache
    mkdir -p "$XDG_CONFIG_HOME/opencode" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"
    cat > "$XDG_CONFIG_HOME/opencode/opencode.json" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "autoshare": false,
  "autoupdate": false,
  "model": "bench/$MODEL",
  "provider": {
    "bench": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Bench OpenRouter",
      "options": { "baseURL": "$PROXY/api/v1", "apiKey": "bench-proxy" },
      "models": { "$MODEL": {} }
    }
  }
}
EOF
    exec opencode run --pure --format json "$PROBE"
    ;;
  reasonix)
    export REASONIX_HOME=/bench/rx-home
    mkdir -p "$REASONIX_HOME"
    cat > "$REASONIX_HOME/config.toml" <<EOF
default_model = "bench/$MODEL"

[[providers]]
name = "bench"
kind = "openai"
base_url = "$PROXY/api/v1"
models = ["$MODEL"]
default = "$MODEL"
api_key_env = "OPENROUTER_API_KEY"
context_window = 1000000
EOF
    echo "OPENROUTER_API_KEY=bench-proxy" > "$REASONIX_HOME/.env"
    exec reasonix -p --output-format json "$PROBE"
    ;;
  aider)
    export OPENAI_API_BASE="$PROXY/api/v1"
    export OPENAI_API_KEY=bench-proxy
    export AIDER_CHECK_UPDATE=false AIDER_ANALYTICS=false
    exec aider --model "openai/$MODEL" \
      --message "$PROBE" \
      --yes-always --no-git --no-auto-commits --no-pretty --no-fancy-input \
      --no-check-update --no-analytics --no-show-model-warnings
    ;;
  dsh)
    export DSH_HOME=/bench/dsh-home
    export DEEPSEEK_API_KEY=bench-proxy
    export DEEPSEEK_BASE_URL="$PROXY/api/v1"
    mkdir -p "$DSH_HOME" /bench/project
    cat > /bench/dsh-run.py <<'PYEOF'
import sys
from deepseek_harness import DeepSeekHarness

prompt = sys.argv[1]
with DeepSeekHarness(
    provider="deepseek-official",
    model=os.environ.get("BENCH_MODEL", "z-ai/glm-5.3-flash"),
    cwd="/bench/project",
    dsh_home="/bench/dsh-home",
    profile="sdk-minimal",
) as harness:
    result = harness.run(prompt, session_id="bench-001")
print(result.final_response)
PYEOF
    exec python3 /bench/dsh-run.py "$PROBE"
    ;;
  *)
    echo "unknown agent: $AGENT" >&2
    exit 2
    ;;
esac
