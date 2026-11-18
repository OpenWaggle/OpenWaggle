/**
 * The dist files OpenWaggle's Pi patches may change, per patched package. `check:pi-runtime`
 * rejects a patch that changes any other file, so a rebase onto a new Pi release cannot widen
 * a patch unnoticed.
 */
export const EXPECTED_PATCH_PATHS = {
  'pi-ai': [
    'dist/api/anthropic-messages.js',
    'dist/api/azure-openai-responses.js',
    // Bedrock client reuse (clearBedrockClients) and the system cache boundary.
    'dist/api/bedrock-converse-stream.d.ts',
    'dist/api/bedrock-converse-stream.js',
    'dist/api/mistral-conversations.js',
    'dist/api/openai-codex-responses.js',
    'dist/api/openai-completions.js',
    'dist/api/openai-responses-shared.js',
    'dist/api/openai-responses.d.ts',
    'dist/api/openai-responses.js',
    'dist/api/pi-messages.js',
    'dist/api/simple-options.js',
    'dist/bedrock-provider.d.ts',
    'dist/bedrock-provider.js',
    'dist/index.d.ts',
    'dist/index.js',
    // Bedrock Claude models declare prompt cache lifetimes so their cache entries can be kept warm.
    'dist/providers/amazon-bedrock.models.js',
    // Pi 1.2.0 moved the compat settings types from types.d.ts to the compat schema.
    'dist/providers/compat-schema.d.ts',
    'dist/providers/openai-codex.models.js',
    'dist/providers/openai.models.js',
    'dist/types.d.ts',
    'dist/utils/claude-capabilities.d.ts',
    'dist/utils/claude-capabilities.js',
    'dist/utils/json-parse.d.ts',
    'dist/utils/json-parse.js',
    'dist/utils/provider-retry.d.ts',
    'dist/utils/provider-retry.js',
    'dist/utils/retry.d.ts',
    'dist/utils/retry.js',
    // Tools in name order, so concurrent MCP registration cannot reorder the cached prompt.
    'dist/utils/transcript.js',
  ],
  'pi-coding-agent': [
    'dist/core/agent-session.d.ts',
    'dist/core/agent-session.js',
    // Bedrock models without catalog prompt cache lifetimes are still kept warm.
    'dist/core/cache-warmer.d.ts',
    'dist/core/cache-warmer.js',
    // Pi 1.4.0 derives provider attribution from the client identity of each request.
    'dist/core/client-identity.d.ts',
    'dist/core/client-identity.js',
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
    // Shorter bash results: the head and tail of long output, the rest saved to a file.
    'dist/core/tools/bash.js',
    // Declared tools are callable from codemode without a repeated codemode signature.
    'dist/extensions/codemode/tool.js',
    'dist/index.d.ts',
    'dist/index.js',
  ],
} as const
