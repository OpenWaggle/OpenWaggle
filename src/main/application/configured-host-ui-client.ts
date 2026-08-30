import { randomUUID } from 'node:crypto'
import { toHostUiJsonValue } from '@shared/host-ui-json'
import { HOST_UI_CONTRACT_VERSION, type HostBackedGuiChannel } from '@shared/types/host-ui-protocol'
import type { LocalSessionClientConnectionInput } from '../session-host/local-session-client'
import { executeLocalSessionCommand } from '../session-host/local-session-client'

type GuiSessionClientInput = Omit<
  LocalSessionClientConnectionInput,
  'workingDirectory' | 'clientKind'
>

export async function executeConfiguredHostUi<C extends HostBackedGuiChannel>(input: {
  readonly client: GuiSessionClientInput
  readonly channel: C
  readonly args: readonly unknown[]
}) {
  const requestId = randomUUID()
  const response = await executeLocalSessionCommand({
    ...input.client,
    clientKind: 'gui',
    payload: {
      contract: 'host-ui-v1',
      request: {
        contractVersion: HOST_UI_CONTRACT_VERSION,
        requestId,
        channel: input.channel,
        args: input.args.map((argument) =>
          argument === undefined
            ? { kind: 'undefined' as const }
            : { kind: 'value' as const, value: toHostUiJsonValue(argument) },
        ),
      },
    },
  })
  if (
    response.contract !== 'host-ui-v1' ||
    response.response.requestId !== requestId ||
    response.response.channel !== input.channel
  ) {
    throw new Error('Session Host returned a mismatched Host UI response.')
  }
  return response.response.result.kind === 'undefined' ? undefined : response.response.result.value
}
