# Spec 61 — OpenAI Codex Subscription Skill Capture

## Objective

Record the OpenAI subscription transport fix as a reusable project skill so future regressions can be diagnosed and corrected consistently.

## PRD Alignment Check

- Reviewed `docs/product/ui-interaction-prd.md`.
- This task does **not** map to any `HC-UI-*` item.
- Scope is project skill documentation and troubleshooting workflow only.

## Plan

- [x] Load and follow the `skill-creator` workflow.
- [x] Scaffold a new project skill under `.openwaggle/skills`.
- [x] Author a concise SKILL.md with trigger conditions, fix workflow, and guardrails.
- [x] Add a reference mapping for known error signatures to root causes/fixes.
- [x] Validate skill structure with the skill validator.

## Review Notes

- Created skill folder:
  - `.openwaggle/skills/openai-codex-subscription-transport/`
- Added core guidance file:
  - `.openwaggle/skills/openai-codex-subscription-transport/SKILL.md`
- Added reference matrix:
  - `.openwaggle/skills/openai-codex-subscription-transport/references/error-signatures.md`
- Preserved generated UI metadata:
  - `.openwaggle/skills/openai-codex-subscription-transport/agents/openai.yaml`
- Skill includes:
  - Transport split contract (API key vs subscription OAuth)
  - Codex endpoint/header/payload normalization
  - Unsupported-parameter handling (`max_output_tokens`)
  - Model-name gate removal guidance
  - Strict token claim validation (`chatgpt_account_id`)
  - Test and validation commands

## Validation

- `python3 /Users/diego.garciabrisa/.codex/skills/.system/skill-creator/scripts/quick_validate.py .openwaggle/skills/openai-codex-subscription-transport`
