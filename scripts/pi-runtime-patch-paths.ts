/**
 * The dist files OpenWaggle's Pi patches may change, per patched package. `check:pi-runtime`
 * rejects a patch that changes any other file, so a rebase onto a new Pi release cannot widen
 * a patch unnoticed.
 */
export const EXPECTED_PATCH_PATHS = {
  'pi-ai': [
    'dist/api/anthropic-messages.js',
    'dist/api/azure-openai-responses.js',
    'dist/api/bedrock-converse-stream.js',
    'dist/api/mistral-conversations.js',
    'dist/api/openai-codex-responses.js',
    'dist/api/openai-completions.js',
    'dist/api/openai-responses-shared.js',
    'dist/api/openai-responses.d.ts',
    'dist/api/openai-responses.js',
    'dist/api/pi-messages.js',
    // Pi 1.2.0 moved the compat settings types from types.d.ts to the compat schema.
    'dist/providers/compat-schema.d.ts',
    'dist/providers/openai-codex.models.js',
    'dist/providers/openai.models.js',
    'dist/utils/json-parse.d.ts',
    'dist/utils/json-parse.js',
    'dist/utils/provider-retry.d.ts',
    'dist/utils/provider-retry.js',
    'dist/utils/retry.d.ts',
    'dist/utils/retry.js',
  ],
  'pi-coding-agent': [
    'dist/core/agent-session.d.ts',
    'dist/core/agent-session.js',
    'dist/core/compaction/compaction.d.ts',
    'dist/core/compaction/compaction.js',
    'dist/core/messages.d.ts',
    'dist/core/messages.js',
    'dist/core/model-runtime.d.ts',
    'dist/core/model-runtime.js',
    'dist/core/sdk.js',
    'dist/core/session-manager.d.ts',
    'dist/core/session-manager.js',
    'dist/core/settings-manager.d.ts',
    'dist/core/settings-manager.js',
    // Pi 1.2.0 moved the settings types to the settings schema.
    'dist/core/settings-schema.d.ts',
    'dist/core/settings-schema.js',
    'dist/index.d.ts',
    'dist/index.js',
  ],
} as const
