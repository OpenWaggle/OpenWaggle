import { createFileRoute } from '@tanstack/react-router'
import { SkillsRouteSurface } from '@/components/app/routing/SkillsRouteSurface'

export const Route = createFileRoute('/skills')({
  component: SkillsRouteSurface,
})
