import type { RememberedPorts } from '../electrobun-trusted-origins'

/** Remembered ports that live as long as the test, instead of in the user's data directory. */
export function memoryRememberedPorts(initial: Readonly<Record<string, number>> = {}) {
  let ports = { ...initial }
  const remembered: RememberedPorts = {
    read: () => ports,
    write: (next) => {
      ports = { ...next }
    },
  }
  return remembered
}
