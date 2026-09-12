import { randomUUID } from 'node:crypto'
import { toHostUiJsonValue } from '@shared/host-ui-json'
import { HOST_UI_CONTRACT_VERSION } from '@shared/types/host-ui-protocol'
import {
  executeLocalSessionCommand,
  type LocalSessionClientConnectionInput,
} from '../session-host/local-session-client'
import {
  ensureLocalSessionHost,
  isLocalSessionHostUnavailable,
} from '../session-host/local-session-host-launcher'

export interface McpOwnerReconciliationDependencies {
  readonly execute: typeof executeLocalSessionCommand
  readonly ensure: (input: Parameters<typeof ensureLocalSessionHost>[0]) => Promise<unknown>
}

async function executeReconciliation(
  client: LocalSessionClientConnectionInput,
  projectPath: string | null | undefined,
  requestId: string,
  execute: typeof executeLocalSessionCommand,
) {
  const response = await execute({
    ...client,
    payload: {
      contract: 'host-ui-v1',
      request: {
        contractVersion: HOST_UI_CONTRACT_VERSION,
        requestId,
        channel: 'mcp:get-settings',
        args: [
          {
            kind: 'value',
            value: toHostUiJsonValue({
              ...(projectPath === undefined ? {} : { projectPath }),
              reconcileRuntime: true,
            }),
          },
        ],
      },
    },
  })
  if (
    response.contract !== 'host-ui-v1' ||
    response.response.requestId !== requestId ||
    response.response.channel !== 'mcp:get-settings'
  ) {
    throw new Error('Session Host returned a mismatched MCP reconciliation response.')
  }
}

export async function reconcileMcpOwnerRuntime(
  client: LocalSessionClientConnectionInput,
  projectPath: string | null | undefined,
  dependencyOverrides: Partial<McpOwnerReconciliationDependencies> = {},
) {
  const dependencies: McpOwnerReconciliationDependencies = {
    execute: executeLocalSessionCommand,
    ensure: ensureLocalSessionHost,
    ...dependencyOverrides,
  }
  const requestId = randomUUID()
  try {
    await executeReconciliation(client, projectPath, requestId, dependencies.execute)
  } catch (error) {
    if (!isLocalSessionHostUnavailable(error)) throw error
    await dependencies.ensure(client)
    await executeReconciliation(client, projectPath, requestId, dependencies.execute)
  }
}
