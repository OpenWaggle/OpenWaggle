import { useState } from 'react'
import { cn } from '@/lib/cn'

interface BaseUrlInputProps {
  providerId: string
  value: string
  onSave: (url: string) => void
}

/** Base URL input that only saves on blur, not on every keystroke */
export function BaseUrlInput({ providerId, value, onSave }: BaseUrlInputProps): React.JSX.Element {
  const [localValue, setLocalValue] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const draftValue = isDirty ? localValue : value

  return (
    <div className="space-y-1.5">
      <label htmlFor={`base-url-${providerId}`} className="text-[13px] text-text-secondary">
        Base URL
      </label>
      <input
        id={`base-url-${providerId}`}
        type="text"
        value={draftValue}
        onChange={(e) => {
          setLocalValue(e.target.value)
          setIsDirty(true)
        }}
        onBlur={() => {
          if (draftValue !== value) {
            onSave(draftValue)
          }
          setIsDirty(false)
          setLocalValue('')
        }}
        placeholder="http://localhost:11434"
        className={cn(
          'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary',
          'placeholder:text-text-tertiary',
          'focus:border-border-light focus:outline-none',
          'transition-colors',
        )}
      />
    </div>
  )
}
