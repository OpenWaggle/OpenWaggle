import type { ScheduledTaskInput, ScheduledTaskPatch } from '@shared/types/scheduled-task'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { executeScheduledTasksCommand, scheduledTasksQueryKeys } from '@/queries/scheduled-tasks'

function useInvalidateScheduledTasks() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: scheduledTasksQueryKeys.all })
}

/** A retried create must not schedule the same work twice, so each submit carries its own key. */
export function useCreateScheduledTask() {
  const invalidate = useInvalidateScheduledTasks()
  return useMutation({
    mutationFn: async (input: ScheduledTaskInput) => {
      const outcome = await executeScheduledTasksCommand(
        { operation: 'create', input },
        crypto.randomUUID(),
      )
      if (outcome.effect !== 'created') throw new Error('The Session Host did not create the task.')
      return outcome.task
    },
    onSettled: invalidate,
  })
}

export function useUpdateScheduledTask() {
  const invalidate = useInvalidateScheduledTasks()
  return useMutation({
    mutationFn: async (variables: {
      readonly taskId: string
      readonly patch: ScheduledTaskPatch
    }) => {
      const outcome = await executeScheduledTasksCommand({ operation: 'update', ...variables })
      if (outcome.effect !== 'updated') throw new Error('The Session Host did not update the task.')
      return outcome.task
    },
    onSettled: invalidate,
  })
}

export function useDeleteScheduledTask() {
  const invalidate = useInvalidateScheduledTasks()
  return useMutation({
    mutationFn: async (taskId: string) => {
      await executeScheduledTasksCommand({ operation: 'delete', taskId })
      return taskId
    },
    onSettled: invalidate,
  })
}

export function useRunScheduledTaskNow() {
  const invalidate = useInvalidateScheduledTasks()
  return useMutation({
    mutationFn: async (taskId: string) => {
      const outcome = await executeScheduledTasksCommand({ operation: 'run-now', taskId })
      if (outcome.effect !== 'run-requested')
        throw new Error('The Session Host did not run the task.')
      return outcome.task
    },
    onSettled: invalidate,
  })
}

/** Pause or resume: the enabled switch, the list row, and the Summary menu all share this. */
export function useSetScheduledTaskEnabled() {
  const update = useUpdateScheduledTask()
  return {
    setEnabled: (taskId: string, enabled: boolean) => update.mutate({ taskId, patch: { enabled } }),
    isPending: update.isPending,
    pendingTaskId: update.isPending ? (update.variables?.taskId ?? null) : null,
    error: update.error,
  }
}
