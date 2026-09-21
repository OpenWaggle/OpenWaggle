import type { ActionCatalog, PreparationDefinition } from '@shared/types/action-definitions'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { expect, it, vi } from 'vitest'
import type { ActionCatalogServiceShape } from '../../../ports/action-catalog-service'
import { rememberPreparationReview } from '../preparation-review'

const definition: PreparationDefinition = {
  id: 'setup',
  profileId: 'default',
  phase: 'setup',
  invocation: { type: 'command', command: 'pnpm install', directory: '.' },
}
const workspace = { workspaceId: 'workspace', projectPath: '/project', workspacePath: '/worktree' }

it('remembers snapshot enablement for future workspaces only when current execution still matches', async () => {
  const catalog: ActionCatalog = {
    revision: 'one',
    actions: [],
    profiles: [],
    preparation: [{ definition, source: 'project', review: 'required' }],
  }
  const read = vi.fn(() => Effect.succeed(catalog))
  const edit = vi.fn(() => Effect.succeed(catalog))
  const service = fromPartial<ActionCatalogServiceShape>({ read, edit })
  await Effect.runPromise(rememberPreparationReview(service, workspace, definition, true))
  expect(edit).toHaveBeenCalledExactlyOnceWith(workspace, 'one', {
    type: 'review-preparation',
    id: 'setup',
    enabled: true,
  })
  edit.mockClear()
  await Effect.runPromise(
    rememberPreparationReview(
      service,
      workspace,
      {
        ...definition,
        invocation: { type: 'command', command: 'older setup', directory: '.' },
      },
      true,
    ),
  )
  expect(edit).not.toHaveBeenCalled()
})
