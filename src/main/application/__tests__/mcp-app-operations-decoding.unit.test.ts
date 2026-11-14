import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import { McpAppRuntimeService } from '../../ports/mcp-app-runtime-service'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { listMcpAppCatalogOperation } from '../mcp-app-operations'

const services = Layer.mergeAll(
  Layer.succeed(McpAppRuntimeService, fromPartial({})),
  Layer.succeed(SessionProjectionRepository, fromPartial({})),
)

function listCatalog(raw: unknown) {
  return Effect.runPromise(
    listMcpAppCatalogOperation(raw).pipe(
      Effect.flip,
      Effect.map((error) => error.message),
      Effect.provide(services),
    ),
  )
}

/** The renderer leaves an absent field out of an MCP App request; it never sends it as undefined. */
describe('MCP App request decoding', () => {
  const request = { sessionId: 'session-1', serverInstanceId: 'server', serverConfigHash: 'hash' }

  it.each(['projectPath', 'sessionId', 'serverConfigHash'])(
    'refuses an explicit undefined %s',
    async (field) => {
      await expect(listCatalog({ ...request, [field]: undefined })).resolves.toBe(
        'Invalid MCP App request.',
      )
    },
  )

  it('reads a missing serverConfigHash as an App opened by an older OpenWaggle', async () => {
    await expect(listCatalog({ sessionId: 'session-1', serverInstanceId: 'server' })).resolves.toBe(
      'This MCP App was opened by an older OpenWaggle; run the tool again.',
    )
  })
})
