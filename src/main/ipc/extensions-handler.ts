import { hostHandle } from './typed-ipc'

export function registerExtensionsHandlers(): void {
  hostHandle('extensions:list-packages')

  hostHandle('extensions:list-contributions')

  hostHandle('extensions:propose-package-write')

  hostHandle('extensions:apply-package-write')

  hostHandle('extensions:propose-package-remove')

  hostHandle('extensions:apply-package-remove')

  hostHandle('extensions:set-trusted')

  hostHandle('extensions:set-enabled')

  hostHandle('extensions:set-project-disabled')

  hostHandle('extensions:accept-update')

  hostHandle('extensions:approve-build')

  hostHandle('extensions:reload')
}
