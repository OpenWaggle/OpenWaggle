/**
 * The named groups a regular expression match captured, typed by the names the pattern declares.
 * TypeScript types `match.groups` as `{ [key: string]: string }`, so reading a group by its known
 * name would read a known key out of an open record; this reads each declared name once, with a
 * variable key, and returns a type that declares them. `null` when the pattern did not match or
 * declares no groups; a group that did not take part in the match is absent.
 */
export function namedGroups<const TName extends string>(
  match: RegExpMatchArray | RegExpExecArray | null | undefined,
  names: readonly TName[],
): Partial<Record<TName, string>> | null {
  const groups = match?.groups
  if (groups === undefined) return null
  const captured: Partial<Record<TName, string>> = {}
  for (const name of names) {
    const value = groups[name]
    if (value !== undefined) captured[name] = value
  }
  return captured
}
