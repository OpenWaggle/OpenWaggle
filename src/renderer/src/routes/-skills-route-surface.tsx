import { SkillsPanel } from '@/features/skills/components'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'

export function SkillsRouteSurface() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <PanelErrorBoundary name="Skills" className="flex min-w-0 flex-1 overflow-hidden">
        <SkillsPanel />
      </PanelErrorBoundary>
    </div>
  )
}
