import type { SessionId } from './brand'
import type {
  RecordSessionChangeRequestInput,
  SessionResource,
  SessionResourceBackfillStatus,
  SessionResourceContent,
  SessionResourceList,
} from './session-resource'

export interface SessionResourceIpcInvokeChannels {
  'sessions:resources:list': {
    args: [sessionId: SessionId]
    return: SessionResourceList
  }
  'sessions:resources:backfill': {
    args: [sessionId: SessionId]
    return: SessionResourceBackfillStatus
  }
  'sessions:resources:read': {
    args: [sessionId: SessionId, resourceId: string]
    return: SessionResourceContent | null
  }
  'sessions:resources:thumbnail': {
    args: [sessionId: SessionId, resourceId: string]
    return: SessionResourceContent | null
  }
  'sessions:resources:retry': {
    args: [sessionId: SessionId, resourceId: string]
    return: undefined
  }
  'sessions:resources:record-change-request': {
    args: [sessionId: SessionId, input: RecordSessionChangeRequestInput]
    return: SessionResource
  }
}
