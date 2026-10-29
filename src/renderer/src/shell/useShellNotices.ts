import { useAutomaticWorktreeRemovalNotice } from '@/shell/useAutomaticWorktreeRemovalNotice'
import { useTitleModelRefusalNotice } from '@/shell/useTitleModelRefusalNotice'

/** The one-time notices the workspace shell shows from Host state. */
export function useShellNotices() {
  useTitleModelRefusalNotice()
  useAutomaticWorktreeRemovalNotice()
}
