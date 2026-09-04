#!/usr/bin/env python3
"""Parse raw benchmark outputs into results.json.

Primary number (turnOneTokens): provider-reported prompt tokens on the FIRST
model call of the conversation, taken from the proxy wire log. This counts
everything the model saw: system prompt, tool schemas, context, user prompt.

Secondary number (cliReported): what the harness's own JSON output claims, kept
for cross-checking. Harnesses that aggregate retries or validator calls can
diverge from the wire; the wire is authoritative.
"""
import json
import sys
from pathlib import Path


def read_jsonl(path: Path):
    events = []
    if not path.exists():
        return events
    for line in path.read_text(errors="replace").splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return events


def wire_truth(results_dir: Path, agent: str):
    """First model call's prompt tokens from the proxy log, plus call count.

    OpenAI-style usage reports the full prompt as prompt_tokens. Anthropic-style
    usage reports uncached input plus cache-write and cache-read separately, so
    injected = input + cache_creation + cache_read.
    """
    events = read_jsonl(results_dir / f"{agent}.proxy.jsonl")
    posts = [event for event in events if event.get("command") == "POST"]
    for record in posts:
        prompts = []
        for usage in record.get("usage_events", []):
            if "prompt_tokens" in usage:
                prompts.append(usage.get("prompt_tokens") or 0)
            elif "input_tokens" in usage:
                prompts.append(
                    (usage.get("input_tokens") or 0)
                    + (usage.get("cache_creation_input_tokens") or 0)
                    + (usage.get("cache_read_input_tokens") or 0)
                )
        prompts = [prompt for prompt in prompts if prompt]
        if prompts:
            return {
                "turnOneTokens": prompts[0],
                "modelCalls": len(posts),
                "wireModel": record.get("model"),
            }
    return None


def load_result_json(path: Path):
    """Parse the first JSON object from an agent output file, or None.

    Agent CLIs sometimes prepend banners or append noise around their JSON;
    a missing or malformed payload must not abort the whole report.
    """
    if not path.exists():
        return None
    raw = path.read_text(errors="replace")
    start = raw.find("{")
    if start < 0:
        return None
    try:
        payload, _ = json.JSONDecoder().raw_decode(raw[start:])
        return payload if isinstance(payload, dict) else None
    except json.JSONDecodeError:
        return None


def cli_pi(results_dir: Path, agent: str):
    for event in reversed(read_jsonl(results_dir / f"{agent}.out")):
        if event.get("type") == "message_end":
            message = event.get("message") or {}
            if message.get("role") == "assistant":
                usage = message.get("usage") or {}
                return {
                    "turnOneTokens": usage.get("input", 0) + usage.get("cacheRead", 0) + usage.get("cacheWrite", 0),
                    "outputTokens": usage.get("output", 0),
                    "stopReason": message.get("stopReason"),
                }
    return {"error": "no assistant usage"}


def cli_claude(results_dir: Path):
    data = load_result_json(results_dir / "claude.out")
    if data is None:
        return {"error": "no JSON result in output"}
    usage = data.get("usage", {})
    return {
        "turnOneTokens": (
            usage.get("input_tokens", 0)
            + usage.get("cache_creation_input_tokens", 0)
            + usage.get("cache_read_input_tokens", 0)
        ),
        "outputTokens": usage.get("output_tokens", 0),
        "isError": data.get("is_error"),
    }


def cli_codex(results_dir: Path):
    for event in reversed(read_jsonl(results_dir / "codex.out")):
        if event.get("type") == "turn.completed":
            usage = event.get("usage", {})
            return {
                "turnOneTokens": usage.get("input_tokens", 0),
                "cachedInputTokens": usage.get("cached_input_tokens", 0),
                "outputTokens": usage.get("output_tokens", 0),
            }
    return {"error": "no turn.completed"}


def cli_opencode(results_dir: Path):
    main = None
    sidecalls = []
    for event in read_jsonl(results_dir / "opencode.out"):
        if event.get("type") != "step_finish":
            continue
        tokens = (event.get("part") or {}).get("tokens") or {}
        cache = tokens.get("cache") or {}
        total = (tokens.get("input", 0) or 0) + (cache.get("read", 0) or 0) + (cache.get("write", 0) or 0)
        if main is None:
            main = {"turnOneTokens": total, "outputTokens": tokens.get("output", 0)}
        else:
            sidecalls.append(total)
    if main is None:
        return {"error": "no step_finish"}
    if sidecalls:
        main["sidecallTokens"] = sidecalls
    return main


def cli_reasonix(results_dir: Path):
    data = load_result_json(results_dir / "reasonix.out")
    if data is None:
        return {"error": "no JSON result in output"}
    usage = data.get("usage", {})
    return {
        "turnOneTokens": (
            usage.get("input_tokens", 0)
            + usage.get("cache_read_input_tokens", 0)
            + usage.get("cache_creation_input_tokens", 0)
        ),
        "outputTokens": usage.get("output_tokens", 0),
        "numTurns": data.get("num_turns"),
    }


PARSERS = {
    "pi081": lambda results_dir: cli_pi(results_dir, "pi081"),
    "pi084": lambda results_dir: cli_pi(results_dir, "pi084"),
    "claude": cli_claude,
    "codex": cli_codex,
    "opencode": cli_opencode,
    "reasonix": cli_reasonix,
    "aider": lambda results_dir: {"error": "wire only"},
    "dsh": lambda results_dir: {"error": "wire only"},
}

NAMES = {
    "aider": "Aider 0.86.2",
    "dsh": "DeepSeek Harness (sdk-minimal)",
    "pi081": "Pi CLI 0.81.1 (OpenWaggle-bundled)",
    "pi084": "Pi CLI 0.84.4",
    "claude": "Claude Code 2.1.247",
    "codex": "Codex CLI 0.150.1",
    "opencode": "opencode 1.18.26",
    "reasonix": "DeepSeek Reasonix 1.35.0",
}


def main():
    results_dir = Path(sys.argv[1])
    results = {
        "model": "z-ai/glm-5.3-flash",
        "environment": (
            "Docker (node:24-bookworm-slim), pinned agent versions, fresh home per agent, "
            "empty project, no AGENTS.md/skills/plugins/extensions/MCP; all traffic through "
            "a local logging proxy injecting the OpenRouter key"
        ),
        "agents": {},
    }
    for agent, cli_parser in PARSERS.items():
        entry = {"name": NAMES[agent]}
        wire = wire_truth(results_dir, agent)
        if wire:
            entry["turnOneTokens"] = wire["turnOneTokens"]
            entry["modelCalls"] = wire["modelCalls"]
        cli = cli_parser(results_dir)
        if "error" not in cli:
            entry["cliReported"] = cli.get("turnOneTokens")
            entry["cli"] = cli
        else:
            entry["cliError"] = cli["error"]
        results["agents"][agent] = entry

    (results_dir / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
