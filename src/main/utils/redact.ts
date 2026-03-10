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
] as const

export function redactSensitiveText(value: string): string {
  let redacted = value
  for (const matcher of SECRET_REDACTION_PATTERNS) {
    redacted = redacted.replace(matcher.pattern, matcher.replacement)
  }
  return redacted
}
