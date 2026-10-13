/**
 * Pi reads `$NAME`, `${NAME}`, and a leading `!command` in MCP `env` and `headers` values and in
 * `oauth.clientSecret`; it takes URLs, commands, and arguments as written. Values that are data,
 * such as vault secrets or values from the MCP Registry, a bundle manifest, or another tool's
 * file, are written so Pi reads them back literally: `$$` is a literal `$`, and `$!` a literal `!`.
 */
export function piLiteral(value: string) {
  const escaped = value.replaceAll('$', () => '$$')
  return escaped.startsWith('!') ? `$${escaped}` : escaped
}

export function piLiteralMap(values: Readonly<Record<string, string>> | undefined) {
  if (!values) return undefined
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, piLiteral(value)]))
}
