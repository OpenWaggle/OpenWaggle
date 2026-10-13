import { createLogger } from '../../../logger'
import { McpVaultError } from '../../../ports/mcp-errors'
import {
  listMcpVaultSecretNames,
  resolveMcpVaultSecret,
  sharedMcpVaultHasSecret,
} from '../../mcp/encrypted-mcp-secret-vault-service'
import { SIGN_IN_OF_ANOTHER_BUILD } from '../../mcp/migration/oauth-state-migration'

const logger = createLogger('mcp-migration')

/** Old vault entries are named after the server instance they signed in to. */
const OLD_SIGN_IN_PREFIX = 'oauth.'

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

type OldSignInRead = { readonly value: string } | { readonly error: unknown }
export type OldSignIns = ReadonlyMap<string, OldSignInRead>

/**
 * The old sign-ins a migration asked for that this build's vault holds, read with the keychain off
 * the main thread and outside the migration's queue and lock.
 */
export async function readOldSignIns(wanted: ReadonlySet<string>) {
  const names = (await listMcpVaultSecretNames()).filter(
    (name) => name.startsWith(OLD_SIGN_IN_PREFIX) && wanted.has(name),
  )
  const reads = await Promise.all(
    names.map(async (name): Promise<OldSignInRead> => {
      try {
        return { value: await resolveMcpVaultSecret(name) }
      } catch (error) {
        return { error }
      }
    }),
  )
  const oldSignIns: OldSignIns = new Map(
    names.map((name, index) => [name, reads[index] ?? { error: new Error('unread') }]),
  )
  return oldSignIns
}

/**
 * An old sign-in, undefined when no build stored one, or `SIGN_IN_OF_ANOTHER_BUILD` when the vault
 * every build shared has it under another build's key. Any other vault failure (a keychain that
 * refused, an unreadable entry) is the migration's failure, so it is tried again.
 */
export async function oldSignIn(oldSignIns: OldSignIns, name: string) {
  const read = oldSignIns.get(name)
  const missing =
    !read ||
    ('error' in read &&
      read.error instanceof McpVaultError &&
      read.error.reason === 'secret-not-found')
  if (missing) {
    // This build's vault took only what its key opens; the rest is another build's to move.
    return (await sharedMcpVaultHasSecret(name)) ? SIGN_IN_OF_ANOTHER_BUILD : undefined
  }
  if ('value' in read) return read.value
  logger.warn('Could not read an old MCP sign-in from the vault', {
    name,
    error: describeError(read.error),
  })
  throw read.error
}
