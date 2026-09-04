# Pinned coding-agent benchmark image.
# Every agent is installed at an exact version so numbers are reproducible.
# At run time each agent gets a fresh home dir, an empty project, and a dummy
# API key; all traffic is forwarded through a local logging proxy that injects
# the real OpenRouter key (see run.sh).
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Aider claims token efficiency via its repo map; pin the Python side here.
RUN pip3 install --break-system-packages --no-cache-dir \
  "aider-chat==0.86.2" \
  "deepseek-harness-sdk==0.1.2a3"

RUN npm install -g --no-audit --no-fund \
  @earendil-works/pi-coding-agent@0.81.1 \
  @anthropic-ai/claude-code@2.1.247 \
  @openai/codex@0.150.1 \
  opencode-ai@1.18.26 \
  reasonix@1.35.0

# Second pi version under its own prefix so both `pi` binaries coexist.
RUN npm install -g --no-audit --no-fund --prefix /opt/pi-latest \
  @earendil-works/pi-coding-agent@0.84.4

WORKDIR /bench
CMD ["/bin/bash"]
