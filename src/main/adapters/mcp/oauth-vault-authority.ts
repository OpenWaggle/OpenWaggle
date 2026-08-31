import type { McpOAuthVault } from './oauth-vault-provider'

type OAuthAuthorityMode = 'active' | 'authorizing' | 'revoked'

interface OAuthAuthorityState {
  generation: number
  mode: OAuthAuthorityMode
  tail: Promise<void>
}

export interface McpOAuthAuthorizationLease {
  readonly vault: McpOAuthVault
  readonly finish: () => Promise<void>
}

function staleAuthorizationError() {
  return new Error('MCP OAuth credentials changed while this operation was in progress.')
}

/**
 * Serializes OAuth vault commits per server and invalidates every runtime
 * provider created before an explicit authorization or logout transition.
 */
export function createMcpOAuthVaultAuthority() {
  const states = new Map<string, OAuthAuthorityState>()

  function stateFor(instanceId: string) {
    const current = states.get(instanceId)
    if (current) return current
    const created: OAuthAuthorityState = {
      generation: 0,
      mode: 'active',
      tail: Promise.resolve(),
    }
    states.set(instanceId, created)
    return created
  }

  function enqueue<T>(state: OAuthAuthorityState, operation: () => Promise<T>) {
    const result = state.tail.then(operation)
    state.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  function assertLease(state: OAuthAuthorityState, generation: number, mode: OAuthAuthorityMode) {
    if (state.generation !== generation || state.mode !== mode) throw staleAuthorizationError()
  }

  function runtimeVault(instanceId: string, vault: McpOAuthVault): McpOAuthVault {
    const state = stateFor(instanceId)
    const generation = state.generation
    function run<T>(operation: () => Promise<T>) {
      return enqueue(state, async () => {
        assertLease(state, generation, 'active')
        return operation()
      })
    }
    return {
      resolve: (name) => run(() => vault.resolve(name)),
      set: (name, value) => run(() => vault.set(name, value)),
      remove: (name) => run(() => vault.remove(name)),
    }
  }

  function beginAuthorization(
    instanceId: string,
    vault: McpOAuthVault,
  ): McpOAuthAuthorizationLease {
    const state = stateFor(instanceId)
    state.generation += 1
    state.mode = 'authorizing'
    const generation = state.generation
    function run<T>(operation: () => Promise<T>) {
      return enqueue(state, async () => {
        assertLease(state, generation, 'authorizing')
        return operation()
      })
    }
    return {
      vault: {
        resolve: (name) => run(() => vault.resolve(name)),
        set: (name, value) => run(() => vault.set(name, value)),
        remove: (name) => run(() => vault.remove(name)),
      },
      finish: () =>
        enqueue(state, async () => {
          if (state.generation === generation && state.mode === 'authorizing') {
            state.mode = 'active'
          }
        }),
    }
  }

  function revoke<T>(instanceId: string, operation: () => Promise<T>) {
    const state = stateFor(instanceId)
    state.generation += 1
    state.mode = 'revoked'
    return enqueue(state, operation)
  }

  return { runtimeVault, beginAuthorization, revoke }
}

export const mcpOAuthVaultAuthority = createMcpOAuthVaultAuthority()
