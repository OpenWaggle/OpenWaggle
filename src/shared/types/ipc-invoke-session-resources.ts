import type { SessionId } from './brand'
import type {
  RecordSessionChangeRequestInput,
  SessionResource,
  SessionResourceContent,
  SessionResourceList,
} from './session-resource'

export interface SessionResourceIpcInvokeChannels {
  'sessions:resources:list': {
    args: [sessionId: SessionId]
    return: SessionResourceList
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
