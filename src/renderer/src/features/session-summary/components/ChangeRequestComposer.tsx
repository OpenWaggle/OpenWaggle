import { getChangeRequestTerminology } from '@shared/utils/source-control-presentation'
import { X } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef } from 'react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { useUIStore } from '@/shell/ui-store'
import { ChangeRequestComposerActions } from './ChangeRequestComposerActions'
import { ChangeRequestFields } from './ChangeRequestFields'
import { resolveBrowserUrl } from './change-request-composer-outcome'
import {
  type ChangeRequestComposerProps,
  useChangeRequestComposer,
} from './use-change-request-composer-controller'

type ChangeRequestComposerModel = ReturnType<typeof useChangeRequestComposer>

function handleCreateShortcut(
  event: KeyboardEvent<HTMLFormElement>,
  composer: ChangeRequestComposerModel,
) {
  if (
    event.key !== 'Enter' ||
    (!event.metaKey && !event.ctrlKey) ||
    event.nativeEvent.isComposing ||
    composer.running ||
    composer.creationBlocked ||
    (composer.createFeatureBranch && composer.branchName.trim().length === 0)
  ) {
    return
  }
  event.preventDefault()
  void composer.create(false)
}

function changeRequestOrigin(props: ChangeRequestComposerProps, createFeatureBranch: boolean) {
  const head = createFeatureBranch ? 'New branch' : (props.vcsStatus?.refName ?? 'Current ref')
  const base =
    props.vcsStatus?.changeRequest?.baseRef ?? props.vcsStatus?.defaultRef ?? 'default branch'
  return `${head} → ${base}`
}

function changeRequestStatus(composer: ChangeRequestComposerModel, shortLabel: string) {
  if (composer.running && composer.pendingResourceRecord) {
    return `Adding ${shortLabel} to Outputs…`
  }
  if (composer.running) return `Creating ${shortLabel}…`
  if (composer.requestCreated) {
    return `${shortLabel} created. Add it to Outputs to complete the session record.`
  }
  return composer.preflight.message
}

export function ChangeRequestComposer(props: ChangeRequestComposerProps) {
  const terminology = getChangeRequestTerminology(props.vcsStatus?.sourceControlProvider?.id)
  const composer = useChangeRequestComposer(props, terminology)
  const showToast = useUIStore((state) => state.showToast)
  const browserUrl =
    resolveBrowserUrl(composer.fallbackUrl, props.vcsStatus) ?? composer.preflight.browserUrl
  const retryButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (composer.pendingResourceRecord && !composer.running && composer.error) {
      retryButtonRef.current?.focus()
    }
  }, [composer.error, composer.pendingResourceRecord, composer.running])
  const close = () => {
    if (!composer.running) props.onClose()
  }

  return (
    <ModalDialog
      label={`Create ${terminology.singular}`}
      onClose={close}
      dismissible={!composer.running}
    >
      <form
        aria-busy={composer.running}
        onSubmit={(event) => event.preventDefault()}
        onKeyDown={(event) => handleCreateShortcut(event, composer)}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm text-text-tertiary">
              {changeRequestOrigin(props, composer.createFeatureBranch)}
            </p>
            <h2 className="truncate text-sm font-semibold text-text-primary">
              Create {terminology.singular}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close change request composer"
            aria-disabled={composer.running}
            onClick={close}
          >
            <X className="size-4" />
          </Button>
        </header>
        <ChangeRequestFields
          model={{
            createFeatureBranch: composer.createFeatureBranch,
            branchName: composer.branchName,
            title: composer.title,
            description: composer.description,
            commitAndPush: composer.commitAndPush,
            gitStatus: props.gitStatus,
            error: composer.error,
            disabled: composer.running || composer.requestCreated,
            onBranchNameChange: composer.setBranchName,
            onTitleChange: composer.setTitle,
            onDescriptionChange: composer.setDescription,
            onCommitAndPushChange: composer.setCommitAndPush,
          }}
        />
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {changeRequestStatus(composer, terminology.shortLabel)}
        </p>
        <ChangeRequestComposerActions
          model={{
            terminology,
            running: composer.running,
            branchMissing:
              composer.creationBlocked ||
              (composer.createFeatureBranch && composer.branchName.trim().length === 0),
            onCreate: (draft) => void composer.create(draft),
            pendingResourceRecord: composer.pendingResourceRecord !== null,
            requestCreated: composer.requestCreated,
            onRetryResourceRecord: composer.retryResourceRecord,
            retryButtonRef,
            browserUrl,
            preflight: composer.preflight,
            onOpenBrowser: () => {
              if (browserUrl) {
                void api.openExternal(browserUrl).catch((cause: unknown) => {
                  showToast(
                    cause instanceof Error
                      ? cause.message
                      : `Could not open this ${terminology.singular}.`,
                    'error',
                  )
                })
              }
            },
          }}
        />
      </form>
    </ModalDialog>
  )
}
