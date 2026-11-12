import {
  type DesktopNotification,
  type DesktopNotificationTarget,
  desktopNotificationIdFor,
} from '@shared/types/desktop-notification'
import type { SessionHostEventPayload } from '@shared/types/session-host-event'
import type { Settings } from '@shared/types/settings'
import {
  DESKTOP_NOTIFICATION_BODIES,
  desktopNotificationPreview,
  desktopNotificationTitle,
  projectNameFromPath,
} from '@shared/utils/desktop-notification-copy'
import * as Effect from 'effect/Effect'
import {
  type DesktopNotificationCandidate,
  type DesktopNotificationSubject,
  desktopNotificationPermitted,
  desktopNotificationReadByVisit,
  desktopNotificationReplaces,
} from '../../domain/desktop-notifications/desktop-notification-policy'
import type { DesktopNotificationFactsShape } from '../../ports/desktop-notification-facts'
import type { DesktopNotificationHostPresenterShape } from '../../ports/desktop-notification-host-presenter'

export interface DesktopNotificationLedgerDependencies {
  readonly facts: DesktopNotificationFactsShape
  readonly readSettings: () => Effect.Effect<Settings, unknown>
  readonly publish: (payload: SessionHostEventPayload) => void
  readonly desktopAppConnected: () => boolean
  readonly hostPresenter: DesktopNotificationHostPresenterShape
}

export interface DesktopNotificationShowInput {
  readonly target: DesktopNotificationTarget
  readonly candidate: DesktopNotificationCandidate
  readonly subject: DesktopNotificationSubject
  readonly title: { readonly title: string; readonly parentTitle?: string | null }
  readonly preview?: string | null
  /** When the event happened; a visit at or after it means the person already saw it. */
  readonly occurredAt: number
}

export function sessionNotificationTarget(sessionId: string): DesktopNotificationTarget {
  return { kind: 'session', sessionId }
}

/**
 * The Desktop notifications still outstanding, one per target (ADR 0062). Showing one applies
 * Settings → Notifications, publishes it for the desktop app, and has the Host show it itself
 * when no desktop app is connected; withdrawing one tells them both.
 */
export class DesktopNotificationLedger {
  private readonly outstanding = new Map<string, DesktopNotification>()
  private revision = 0

  private readonly dependencies: DesktopNotificationLedgerDependencies

  constructor(dependencies: DesktopNotificationLedgerDependencies) {
    this.dependencies = dependencies
  }

  /** Every notification still outstanding, oldest first. */
  list(): readonly DesktopNotification[] {
    return [...this.outstanding.values()]
  }

  get(target: DesktopNotificationTarget) {
    return this.outstanding.get(desktopNotificationIdFor(target)) ?? null
  }

  /** Whether the person's settings let `candidate` notify about `subject`. */
  permits(candidate: DesktopNotificationCandidate, subject: DesktopNotificationSubject) {
    return this.dependencies
      .readSettings()
      .pipe(
        Effect.map((settings) =>
          desktopNotificationPermitted(settings.desktopNotifications, candidate, subject),
        ),
      )
  }

  show(input: DesktopNotificationShowInput) {
    return Effect.gen(this, function* () {
      const settings = yield* this.dependencies.readSettings()
      const preferences = settings.desktopNotifications
      const { category, reason } = input.candidate
      if (!desktopNotificationPermitted(preferences, input.candidate, input.subject)) return
      const id = desktopNotificationIdFor(input.target)
      const standing = this.outstanding.get(id)
      if (standing && !desktopNotificationReplaces(standing.category, category)) return
      if (yield* this.alreadySeen(input)) return
      const preview = preferences.showPreviews
        ? desktopNotificationPreview(input.preview)
        : undefined
      this.revision += 1
      const notification: DesktopNotification = {
        id,
        revision: this.revision,
        target: input.target,
        category,
        reason,
        title: desktopNotificationTitle({
          title: input.title.title,
          projectName: projectNameOf(settings, input.subject.projectPath),
          parentTitle: input.title.parentTitle ?? null,
        }),
        body: DESKTOP_NOTIFICATION_BODIES[reason],
        ...(preview ? { preview } : {}),
        createdAt: input.occurredAt,
        presentedBy: this.dependencies.desktopAppConnected() ? 'desktop' : 'host',
      }
      this.outstanding.delete(id)
      this.outstanding.set(id, notification)
      this.dependencies.publish({ kind: 'desktop-notification-shown', notification })
      if (notification.presentedBy === 'host') {
        this.dependencies.hostPresenter.show(
          notification,
          preferences.sounds[category] === 'none' ? 'none' : 'system',
        )
      }
    })
  }

  withdraw(target: DesktopNotificationTarget) {
    const id = desktopNotificationIdFor(target)
    const standing = this.outstanding.get(id)
    if (!standing) return Effect.void
    this.outstanding.delete(id)
    this.dependencies.publish({
      kind: 'desktop-notification-withdrawn',
      notificationId: id,
      revision: standing.revision,
    })
    this.dependencies.hostPresenter.withdraw(id)
    return Effect.void
  }

  /** A Session visited since the notification's event no longer needs to be read. */
  withdrawIfVisited(sessionId: string) {
    const target = sessionNotificationTarget(sessionId)
    const standing = this.get(target)
    if (!standing || !desktopNotificationReadByVisit(standing.category)) return Effect.void
    return Effect.gen(this, function* () {
      const visitedAt = yield* this.dependencies.facts.lastVisitedAt(sessionId)
      const current = this.get(target)
      if (visitedAt !== null && current && visitedAt >= current.createdAt) {
        yield* this.withdraw(target)
      }
    })
  }

  private alreadySeen(input: DesktopNotificationShowInput) {
    if (input.target.kind !== 'session') return Effect.succeed(false)
    if (!desktopNotificationReadByVisit(input.candidate.category)) return Effect.succeed(false)
    return this.dependencies.facts
      .lastVisitedAt(input.target.sessionId)
      .pipe(Effect.map((visitedAt) => visitedAt !== null && visitedAt >= input.occurredAt))
  }
}

function projectNameOf(settings: Settings, projectPath: string | null) {
  if (!projectPath) return null
  return settings.projectDisplayNames[projectPath] ?? projectNameFromPath(projectPath)
}
