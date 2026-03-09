import type { OpenWaggleApi } from '@shared/types/ipc'

declare global {
  interface Window {
    api: OpenWaggleApi
  }
}

const isDevelopment = typeof window !== 'undefined' && window.location.protocol !== 'file:'
const APPROVAL_TRACE_STORAGE_KEY = 'openwaggle.approvalTrace'
const logLevel = 'info'

function getApprovalTraceEnabled(): boolean {
  if (!isDevelopment || typeof window === 'undefined') {
    return false
  }

  try {
    return window.localStorage.getItem(APPROVAL_TRACE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export const env = {
  isDevelopment,
  approvalTraceEnabled: getApprovalTraceEnabled(),
  logLevel,
} as const
