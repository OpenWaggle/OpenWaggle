import { ClipboardList } from 'lucide-react'

export function PlanModeBanner(): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3.5 py-2">
      <ClipboardList className="h-3.5 w-3.5 text-accent shrink-0" />
      <span className="text-[13px] text-accent">
        Plan mode — the agent will present a plan before making changes
      </span>
    </div>
  )
}
