import type { SessionEntry } from '@earendil-works/pi-coding-agent'

/**
 * The file holds the `count` entries a projection was taken from and, after them, at most usage
 * entries: the cost records a warming session appends for each prompt cache refresh. They change
 * no transcript node a Session shows, so the projection deliberately leaves them out.
 */
export function onlyUsageAppendedAfter(entries: readonly SessionEntry[], count: number) {
  return entries.length >= count && entries.slice(count).every((entry) => entry.type === 'usage')
}
