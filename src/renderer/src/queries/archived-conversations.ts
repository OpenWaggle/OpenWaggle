import type { ConversationId } from '@shared/types/brand'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/ipc'
import { queryKeys } from './query-keys'

export function archivedConversationsQueryOptions() {
  return queryOptions({
    queryKey: queryKeys.archivedConversations,
    queryFn: () => api.listArchivedConversations(),
  })
}

export function useUnarchiveConversationMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conversationId: ConversationId) => api.unarchiveConversation(conversationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.archivedConversations,
        exact: true,
      })
    },
  })
}

export function useArchivedDeleteConversationMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conversationId: ConversationId) => api.deleteConversation(conversationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.archivedConversations,
        exact: true,
      })
    },
  })
}
