/**
 * Portable Agent definition names: lowercase letters, digits, `.`, `_` and `-`, at most 80
 * characters, starting and ending with a letter or digit, and never a reserved Windows basename. The
 * published JSON Schema uses this exact pattern.
 */
export const AGENT_DEFINITION_NAME_PATTERN =
  /^(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$))[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/

export function isAgentDefinitionName(value: string) {
  return AGENT_DEFINITION_NAME_PATTERN.test(value)
}
