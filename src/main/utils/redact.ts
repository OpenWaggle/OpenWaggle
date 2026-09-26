const SECRET_REDACTION_PATTERNS = [
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
  },
  {
    pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
    replacement: 'Bearer [REDACTED_TOKEN]',
  },
  {
    pattern: /\b(sk-[A-Za-z0-9_-]{16,})\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    pattern: /\b(github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,})\b/g,
    replacement: '[REDACTED_GITHUB_TOKEN]',
  },
  {
    pattern: /\bBasic\s+[A-Za-z0-9+/]{8,}=*/gi,
    replacement: 'Basic [REDACTED_CREDENTIALS]',
  },
  {
    // Google API keys.
    pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g,
    replacement: '[REDACTED_API_KEY]',
  },
  {
    // AWS access key ids.
    pattern: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED_ACCESS_KEY]',
  },
  {
    /*
     * Labelled credentials: `x-api-key: ...`, `api_key=...`, `"token": "..."`, `password=...`,
     * whole environment-variable names such as `ANTHROPIC_API_KEY=...`, `AWS_SECRET_ACCESS_KEY=...`
     * or `NPM_TOKEN=...`, and prose such as `API key: ...`. The label must end with the credential
     * word, so `token_count=483` is left alone.
     */
    pattern:
      /\b([A-Za-z0-9_-]*?(?:api[_ -]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?access[_-]?key|secret[_-]?key|secret|password|passwd|token))(["']?\s*[:=]\s*["']?)(?!\[REDACTED)[^\s"',;&]{6,}/gi,
    replacement: '$1$2[REDACTED]',
  },
] as const

export function redactSensitiveText(value: string): string {
  let redacted = value
  for (const matcher of SECRET_REDACTION_PATTERNS) {
    redacted = redacted.replace(matcher.pattern, matcher.replacement)
  }
  return redacted
}
