export { ChatPanelContent } from './ChatPanel'
export { ScrollToBottomButton } from './ScrollToBottomButton'

export function loadChatDiffPane() {
  return import('./ChatDiffPane').then((module) => ({
    default: module.ChatDiffPane,
  }))
}
