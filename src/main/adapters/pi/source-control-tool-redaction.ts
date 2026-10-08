import { redactSensitiveText } from '../../utils/redact'

/** `scheme://user:secret@` inside any text; a username alone can be a token. */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/giu
/** GitHub (`gho_`, `ghu_`, `ghs_`, `ghr_`, `ghp_`) and GitLab (`glpat-` and kin) tokens. */
const PROVIDER_TOKENS =
  /\b(?:gh[opsur]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gl(?:pat|oas|dt|rt|ptt|cbt|imt|ft|soat|agent)-[A-Za-z0-9_-]{20,})/gu

/** CLI or git text with every credential it might carry removed, before it reaches the model. */
export function redactSourceControlText(text: string) {
  return redactSensitiveText(
    text.replace(URL_USERINFO, '$1').replace(PROVIDER_TOKENS, '[REDACTED_TOKEN]'),
  )
}

/** A remote URL without its userinfo, such as `https://token@host/...`. */
export function redactRemoteUrl(url: string) {
  if (!URL.canParse(url)) return redactSourceControlText(url)
  const parsed = new URL(url)
  if (!parsed.username && !parsed.password) return redactSourceControlText(url)
  parsed.username = ''
  parsed.password = ''
  return redactSourceControlText(parsed.toString())
}
