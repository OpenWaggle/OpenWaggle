interface ActionDialogErrorProps {
  readonly message: string | null
}

export function ActionDialogError({ message }: ActionDialogErrorProps) {
  if (!message) return null

  return (
    <div className="mt-3 rounded-md border border-error/30 bg-error/10 px-2.5 py-1.5 text-[12px] text-error">
      {message}
    </div>
  )
}
