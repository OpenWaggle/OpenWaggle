import type { ConversationId } from '@shared/types/brand'
import type { Conversation, ConversationSummary } from '@shared/types/conversation'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/ipc'
import { queryKeys } from './query-keys'

// ─── Query Options ───────────────────────────────────────────

export function conversationsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.conversations,
    queryFn: async (): Promise<ConversationSummary[]> => {
      const all = await api.listConversations()
      // Filter out untitled draft threads that have no messages yet —
      // these are freshly created conversations awaiting their first send.
      // They appear in the sidebar only once the LLM title is generated.
      return all.filter((c) => c.title !== 'New thread' || c.messageCount > 0)
    },
  })
}

export function conversationQueryOptions(id: ConversationId | null) {
  return queryOptions({
    queryKey: queryKeys.conversation(id),
    queryFn: async (): Promise<Conversation> => {
      if (!id) {
        throw new Error('Cannot fetch conversation without an ID')
      }
      const conv = await api.getConversation(id)
      if (!conv) {
        throw new Error(`Conversation ${id} not found`)
      }
      return conv
    },
    enabled: id !== null,
  })
}

// ─── Mutations ───────────────────────────────────────────────

export function useDeleteConversationMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: ConversationId) => api.deleteConversation(id),
    onMutate: async (id: ConversationId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.conversations })
      const previous = queryClient.getQueryData<ConversationSummary[]>(queryKeys.conversations)
      queryClient.setQueryData<ConversationSummary[]>(queryKeys.conversations, (old) =>
        old ? old.filter((c) => c.id !== id) : [],
      )
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.conversations, context.previous)
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations })
    },
  })
}

export function useUpdateConversationProjectPathMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, projectPath }: { id: ConversationId; projectPath: string | null }) => {
      const updated = await api.updateConversationProjectPath(id, projectPath)
      return updated
    },
    onSuccess: async (updated, vars) => {
      if (updated) {
        queryClient.setQueryData<Conversation>(queryKeys.conversation(vars.id), updated)
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversations })
    },
  })
}

export function useTogglePlanModeMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, active }: { id: ConversationId; active: boolean }) => {
      const updated = await api.updateConversationPlanMode(id, active)
      return updated
    },
    onSuccess: (updated, { id }) => {
      if (updated) {
        queryClient.setQueryData<Conversation>(queryKeys.conversation(id), updated)
      }
    },
  })
}
