import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'
import {
  type ContributionPillTone,
  contributionPillToneClassName,
} from './settings-contribution-host-model'

export function SettingsContributionPill({
  children,
  tone,
}: {
  readonly children: ReactNode
  readonly tone: ContributionPillTone
}) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[10px] font-medium',
        contributionPillToneClassName(tone),
      )}
    >
      {children}
    </span>
  )
}
