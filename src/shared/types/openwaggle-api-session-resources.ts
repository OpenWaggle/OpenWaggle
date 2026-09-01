import type { SessionId } from './brand'
import type { IpcEventPayload } from './ipc'
import type {
  RecordSessionChangeRequestInput,
  SessionResource,
  SessionResourceBackfillStatus,
  SessionResourceContent,
  SessionResourceList,
} from './session-resource'

type SessionResourceReader = (
  ...args: [SessionId, string]
) => Promise<SessionResourceContent | null>

export interface OpenWaggleSessionResourceApi {
  onSessionResourcesInvalidated(
    callback: (payload: IpcEventPayload<'sessions:resources-invalidated'>) => void,
  ): () => void
  listSessionResources(sessionId: SessionId): Promise<SessionResourceList>
  advanceSessionResourceBackfill(sessionId: SessionId): Promise<SessionResourceBackfillStatus>
  readSessionResource: SessionResourceReader
  readSessionResourceThumbnail: SessionResourceReader
  retrySessionResource(sessionId: SessionId, resourceId: string): Promise<void>
  recordSessionChangeRequest(
    sessionId: SessionId,
    input: RecordSessionChangeRequestInput,
  ): Promise<SessionResource>
}
