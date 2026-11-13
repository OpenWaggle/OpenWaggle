import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appPaths } from '../../desktop-shell/app-paths'

/**
 * Ports of the loopback trusted origins that keep their origin between launches, by
 * `<domain>/<host>`. Web storage and compiled code are keyed by origin, so the renderer keeps its
 * port to keep its local storage (`electrobun-trusted-origins.ts`).
 */
export interface RememberedPorts {
  readonly read: () => Readonly<Record<string, number>>
  readonly write: (ports: Readonly<Record<string, number>>) => void
}

const PORTS_FILE = 'trusted-origin-ports.json'
const JSON_INDENT = 2

function isPortRecord(value: unknown): value is Readonly<Record<string, number>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((port) => typeof port === 'number')
  )
}

/** Remembers ports in `<userData>/trusted-origin-ports.json`, beside the web profile. */
export function userDataRememberedPorts() {
  const file = () => join(appPaths.userData(), PORTS_FILE)
  return {
    read: () => {
      try {
        const parsed: unknown = JSON.parse(readFileSync(file(), 'utf8'))
        return isPortRecord(parsed) ? parsed : {}
      } catch {
        // A first launch has no file; an unreadable one only costs the remembered ports.
        return {}
      }
    },
    write: (ports) => writeFileSync(file(), `${JSON.stringify(ports, null, JSON_INDENT)}\n`),
  } satisfies RememberedPorts
}
