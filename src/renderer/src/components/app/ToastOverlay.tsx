import { useUIStore } from '@/stores/ui-store'

export function ToastOverlay(): React.JSX.Element | null {
  const message = useUIStore((s) => s.toastMessage)

  if (!message) {
    return null
  }

  return (
    <div className="pointer-events-none fixed right-5 top-5 z-[70] rounded-lg border border-border-light bg-bg-secondary px-3 py-2 text-[13px] text-text-secondary shadow-lg">
      {message}
    </div>
  )
}
