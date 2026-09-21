import { startAccessCliIfRequested } from './access-cli-entry'
import { startAgentsCliIfRequested } from './agents-cli-entry'
import { startDelegationsCliIfRequested } from './delegations-cli-entry'
import { startMcpCliIfRequested } from './mcp-cli-entry'
import { startRecoveryCliIfRequested } from './recovery-cli-entry'
import { startSessionHostCliIfRequested } from './session-host-cli-entry'
import { startSessionsCliIfRequested } from './sessions-cli-entry'
import { startUpdateCliIfRequested } from './update-cli-entry'

export function startAppCliIfRequested(argv: readonly string[]) {
  return (
    startSessionHostCliIfRequested(argv) ||
    startAccessCliIfRequested(argv) ||
    startSessionsCliIfRequested(argv) ||
    startDelegationsCliIfRequested(argv) ||
    startAgentsCliIfRequested(argv) ||
    startUpdateCliIfRequested(argv) ||
    startRecoveryCliIfRequested(argv) ||
    startMcpCliIfRequested(argv)
  )
}
