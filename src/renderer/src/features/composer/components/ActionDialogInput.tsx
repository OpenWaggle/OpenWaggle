import type { KeyboardEvent, RefObject } from 'react'
import { TextInput } from '@/shared/ui/TextInput'

interface ActionDialogInputProps {
  readonly inputRef: RefObject<HTMLInputElement | null>
  readonly value: string
  readonly placeholder: string | undefined
  readonly onValueChange: (value: string) => void
  readonly onConfirm: () => void
}

export function ActionDialogInput({
  inputRef,
  value,
  placeholder,
  onValueChange,
  onConfirm,
}: ActionDialogInputProps) {
  if (!placeholder) return null

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    void onConfirm()
  }

  return (
    <TextInput
      ref={inputRef}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      inputSize="sm"
      className="mt-3 h-9 border-border"
    />
  )
}
