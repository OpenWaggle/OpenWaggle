/**
 * Agent definitions and Session profiles from before ADR 0048 may name an MCP server by its old
 * instance ID. The migration recorded which name each ID stood for; these map such references.
 */

/** The references with each old instance ID replaced by its server name, without duplicates. */
export function resolveLegacyMcpServerReferences(
  references: readonly string[],
  legacyNames: ReadonlyMap<string, string>,
): readonly string[] {
  return [...new Set(references.map((reference) => legacyNames.get(reference) ?? reference))]
}

/** The old instance IDs that stand for one of `names`: also valid references to those servers. */
export function legacyMcpServerAliases(
  names: readonly string[],
  legacyNames: ReadonlyMap<string, string>,
): readonly string[] {
  const configured = new Set(names)
  return [...legacyNames]
    .filter(([instanceId, name]) => configured.has(name) && !configured.has(instanceId))
    .map(([instanceId]) => instanceId)
}
