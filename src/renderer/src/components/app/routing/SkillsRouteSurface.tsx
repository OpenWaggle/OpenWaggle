import { PanelErrorBoundary } from '@/components/shared/PanelErrorBoundary'
import { SkillsPanel } from '@/components/skills/SkillsPanel'

export function SkillsRouteSurface() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <PanelErrorBoundary name="Skills" className="flex min-w-0 flex-1 overflow-hidden">
        <SkillsPanel />
      </PanelErrorBoundary>
    </div>
  )
}
