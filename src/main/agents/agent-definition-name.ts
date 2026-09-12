const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/
const WINDOWS_RESERVED_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/

export function isAgentDefinitionName(value: string) {
  return NAME_PATTERN.test(value) && !WINDOWS_RESERVED_BASENAME.test(value)
}
