export const COMPOSER_TEXTAREA_MAX_HEIGHT_PX = 300

export function resetComposerTextareaHeight(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) return
  textarea.style.height = 'auto'
}

export function resizeComposerTextarea(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) return
  resetComposerTextareaHeight(textarea)
  textarea.style.height = `${Math.min(textarea.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT_PX)}px`
}
