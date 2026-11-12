import { actionExecutionKey } from '@shared/utils/action-execution-key'
import { allInOrder } from '@shared/utils/all-in-order'
import type { StartManagedActionInput } from '../../ports/action-run-service'
import type { ManagedActionDependencies } from './managed-action-runs'
import { resolveActionInvocation } from './task-discovery'
export async function resolveManagedActionLaunch(
  input: StartManagedActionInput,
  deps: Pick<ManagedActionDependencies, 'catalog' | 'environment' | 'runner'>,
) {
  const catalog = await deps.catalog(input.workspace)
  const definition = catalog.actions.find(
    ({ definition }) => definition.id === input.actionId,
  )?.definition
  if (!definition) throw new Error('This action is no longer available in the workspace.')
  if (
    input.expectedExecutionKey !== undefined &&
    input.expectedExecutionKey !== actionExecutionKey(definition)
  ) {
    throw new Error(
      'The action changed during authorization. Review its current execution before starting.',
    )
  }
  const [invocation, environment] = await allInOrder([
    resolveActionInvocation(input.workspace.workspacePath, definition.invocation),
    deps.environment(input.workspace),
  ])
  await deps.runner.validate(invocation, environment)
  return { definition, invocation, environment }
}
