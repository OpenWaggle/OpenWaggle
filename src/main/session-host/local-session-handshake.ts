import type { Socket } from 'node:net'
import { decodeLocalSessionClientHello } from '@shared/schemas/local-session-protocol'
import { negotiateLocalSessionProtocol } from './local-session-negotiation'
import type { LocalSessionAuthenticationBudget } from './local-session-resource-policy'
import type {
  AuthenticatedLocalSessionCaller,
  LocalSessionServerDependencies,
} from './local-session-server'

interface LocalSessionHandshakeInput {
  readonly value: unknown
  readonly socket: Socket
  readonly dependencies: LocalSessionServerDependencies
  readonly budget: LocalSessionAuthenticationBudget
  readonly signal: AbortSignal
  readonly send: (frame: unknown) => Promise<void>
  readonly authenticationFailed: (error: unknown) => Promise<void>
}

async function authenticate(
  input: LocalSessionHandshakeInput,
  hello: ReturnType<typeof decodeLocalSessionClientHello>,
) {
  return input.budget.run({
    ...(hello.profile ? { key: hello.profile } : {}),
    signal: input.signal,
    authenticate: () => input.dependencies.authenticate(hello, input.socket),
  })
}

export async function establishLocalSessionHandshake(input: LocalSessionHandshakeInput): Promise<
  | { readonly status: 'closed' }
  | {
      readonly status: 'accepted'
      readonly caller: AuthenticatedLocalSessionCaller
      readonly revision: number
      readonly negotiation: unknown
    }
> {
  const hello = decodeLocalSessionClientHello(input.value)
  const preliminary = negotiateLocalSessionProtocol(hello, input.dependencies.hostInstanceId)
  if (!preliminary.accepted && preliminary.code === 'incompatible_protocol') {
    await input.send(preliminary)
    input.socket.end()
    return { status: 'closed' }
  }
  let caller: AuthenticatedLocalSessionCaller
  try {
    caller = await authenticate(input, hello)
  } catch (error) {
    await input.authenticationFailed(error)
    return { status: 'closed' }
  }
  if (!preliminary.accepted) {
    const mayRequestUpgrade =
      caller.callerId === 'gui:local-user' || caller.callerId.startsWith('local-user:')
    if (!mayRequestUpgrade) {
      await input.send({
        accepted: false,
        protocol: preliminary.protocol,
        code: 'incompatible_protocol',
        supportedRevisions: preliminary.supportedRevisions,
      })
      input.socket.end()
      return { status: 'closed' }
    }
    const blockers = (await input.dependencies.describeUpgradeBlockers?.()) ?? {
      blockingRuns: [],
      blockingOperations: [],
    }
    await input.send(
      negotiateLocalSessionProtocol(hello, input.dependencies.hostInstanceId, blockers),
    )
    input.socket.end()
    input.dependencies.requestUpgradeDrain?.()
    return { status: 'closed' }
  }
  return {
    status: 'accepted',
    caller,
    revision: preliminary.revision,
    negotiation: preliminary,
  }
}
