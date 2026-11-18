import { useTerminalStore } from '../terminal-store'

export const TERMINAL_STORE_OWNER = 'owner-1'

export function resetTerminalStore() {
  useTerminalStore.setState({
    groups: {},
    activity: {},
    portPreviews: {},
    exits: {},
  })
}

export function terminalStore() {
  return useTerminalStore.getState()
}
