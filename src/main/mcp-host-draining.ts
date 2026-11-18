/**
 * Whether the Session Host is draining, for MCP reads the Host still admits then (Settings'
 * configuration and server states): they answer from the current files and sign-in store instead
 * of waiting for the migration, which may wait on a 30 s file lock or the keychain and would hold
 * the drain open. The Session Host installs the probe; elsewhere nothing drains.
 */
let probe: () => boolean = () => false

export function installMcpHostDrainingProbe(isDraining: () => boolean) {
  probe = isDraining
  return () => {
    if (probe === isDraining) probe = () => false
  }
}

export function isMcpHostDraining() {
  return probe()
}
