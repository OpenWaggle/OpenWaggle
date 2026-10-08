import { fromPartial } from '@total-typescript/shoehorn'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { migrateBeforeImports } from '../migrating-mcp-import-service'

describe('MCP imports', () => {
  it("migrate OpenWaggle's files before previewing or applying against them", async () => {
    const order: string[] = []
    const service = migrateBeforeImports(
      {
        preview: (input) =>
          Effect.sync(() => {
            order.push(`preview ${input.projectPath}`)
            return fromPartial({ candidates: [] })
          }),
        apply: (input) =>
          Effect.sync(() => {
            order.push(`apply ${input.projectPath}`)
            return fromPartial({ imported: [] })
          }),
      },
      async (projectPath) => {
        order.push(`migrate ${projectPath}`)
      },
    )

    await Effect.runPromise(service.preview(fromPartial({ projectPath: '/work/app' })))
    await Effect.runPromise(service.apply(fromPartial({ projectPath: null }), () => Effect.void))

    expect(order).toEqual(['migrate /work/app', 'preview /work/app', 'migrate null', 'apply null'])
  })
})
