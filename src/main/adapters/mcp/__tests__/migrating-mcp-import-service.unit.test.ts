import { fromPartial } from '@total-typescript/shoehorn'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { migrateBeforeImports } from '../migrating-mcp-import-service'
import type { PendingMcpFileMigration } from '../migration/migration-health'

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

  it('preview from the current files while the Host drains, and still migrate before applying', async () => {
    const order: string[] = []
    const service = migrateBeforeImports(
      {
        preview: () =>
          Effect.sync(() => {
            order.push('preview')
            return fromPartial({ candidates: [] })
          }),
        apply: () =>
          Effect.sync(() => {
            order.push('apply')
            return fromPartial({ imported: [] })
          }),
      },
      async () => {
        order.push('migrate')
      },
      { skipReadsWhile: () => true },
    )

    await Effect.runPromise(service.preview(fromPartial({ projectPath: null })))
    await Effect.runPromise(service.apply(fromPartial({ projectPath: null }), () => Effect.void))

    expect(order).toEqual(['preview', 'migrate', 'apply'])
  })

  it('refuse to apply while the migration of a file it may write is failing', async () => {
    const applied: string[] = []
    let pending: PendingMcpFileMigration | undefined = {
      path: '/home/user/.openwaggle/mcp.json',
      error: 'the migration lock was busy',
      cause: 'wait',
      keepsLegacyState: true,
    }
    const service = migrateBeforeImports(
      {
        preview: () => Effect.succeed(fromPartial({ candidates: [] })),
        apply: (input) =>
          Effect.sync(() => {
            applied.push(String(input.projectPath))
            return fromPartial({ imported: [] })
          }),
      },
      async () => undefined,
      { pendingMigration: () => pending },
    )
    const apply = service.apply(fromPartial({ projectPath: null }), () => Effect.void)

    const refused = await Effect.runPromise(Effect.flip(apply))
    expect(refused.message).toContain('MCP settings are still being updated')
    expect(applied).toEqual([])

    pending = undefined
    await Effect.runPromise(apply)
    expect(applied).toEqual(['null'])
  })
})
