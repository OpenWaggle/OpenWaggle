import { OPENWAGGLE_EXTENSION_BROKER } from './extension-broker'
import { OPENWAGGLE_EXTENSION } from './extensions'

export const EXTENSION_FRAME_MESSAGE_CHANNEL = 'openwaggle-extension-frame'

export const EXTENSION_FRAME_BOOTSTRAP_SCRIPT = `
const CHANNEL = 'openwaggle-extension-frame';
const BROKER_CAPABILITY = {
  HOST_CONTEXT: '${OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT}',
  STORAGE: '${OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE}',
  STATE: '${OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE}',
  ACTIONS: '${OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS}',
  SETTINGS: '${OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS}',
};
const BROKER_METHOD = {
  GET_SCOPE: '${OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE}',
  GET: '${OPENWAGGLE_EXTENSION_BROKER.METHOD.GET}',
  SET: '${OPENWAGGLE_EXTENSION_BROKER.METHOD.SET}',
  DELETE: '${OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE}',
  LIST: '${OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST}',
  GET_STATE: '${OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE}',
  SELECT_PROJECT: '${OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT}',
  GET_SETTINGS: '${OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS}',
  UPDATE_SETTINGS: '${OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS}',
};
const STORAGE_KIND = {
  STATE: '${OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE}',
  CONFIG: '${OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG}',
};
const STORAGE_SCOPE = {
  GLOBAL: '${OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND}',
  PROJECT: '${OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND}',
};

function describeError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function readConfig() {
  const rawConfig = document.body.dataset.openwaggleConfig;
  if (!rawConfig) {
    throw new Error('Missing OpenWaggle extension frame configuration.');
  }
  return JSON.parse(rawConfig);
}

function isFrameMessage(value, frameId) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      value.channel === CHANNEL &&
      value.frameId === frameId,
  );
}

const config = readConfig();
const root = document.getElementById('openwaggle-extension-root');
if (!root) {
  throw new Error('Missing OpenWaggle extension frame root.');
}

let cleanup = null;
let disposed = false;
let invokeSequence = 0;
let resizeAnimationFrame = 0;
let resizeObserver = null;
const pendingInvocations = new Map();

function post(message) {
  parent.postMessage({ channel: CHANNEL, frameId: config.frameId, ...message }, '*');
}

function measureFrameHeight() {
  return Math.ceil(
    Math.max(
      root.scrollHeight,
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
    ),
  );
}

function postFrameHeight() {
  resizeAnimationFrame = 0;
  if (!disposed) {
    post({ type: 'resize', height: measureFrameHeight() });
  }
}

function scheduleFrameResize() {
  if (resizeAnimationFrame !== 0) {
    return;
  }
  resizeAnimationFrame = requestAnimationFrame(postFrameHeight);
}

function startResizeObserver() {
  scheduleFrameResize();
  if (typeof ResizeObserver !== 'function') {
    return;
  }

  resizeObserver = new ResizeObserver(scheduleFrameResize);
  resizeObserver.observe(root);
  resizeObserver.observe(document.body);
}

function stopResizeObserver() {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (resizeAnimationFrame !== 0) {
    cancelAnimationFrame(resizeAnimationFrame);
    resizeAnimationFrame = 0;
  }
}

function runCleanup() {
  stopResizeObserver();
  if (!cleanup) {
    return;
  }

  const cleanupCallback = cleanup;
  cleanup = null;
  try {
    cleanupCallback();
  } catch (error) {
    post({ type: 'cleanup-error', message: describeError(error) });
  }
}

function invoke(input) {
  const requestId = String(++invokeSequence);
  post({ type: 'invoke', requestId, input });
  return new Promise((resolve) => {
    pendingInvocations.set(requestId, resolve);
  });
}

function storagePayload(storageKind, storageScope, key, value) {
  const payload = { storageKind, storageScope };
  if (key !== undefined) {
    payload.key = key;
  }
  if (value !== undefined) {
    payload.value = value;
  }
  return payload;
}

function createStorageScopeSdk(storageKind, storageScope) {
  return {
    get: (scope, key) =>
      invoke({
        capability: BROKER_CAPABILITY.STORAGE,
        method: BROKER_METHOD.GET,
        scope,
        payload: storagePayload(storageKind, storageScope, key),
      }),
    set: (scope, key, value) =>
      invoke({
        capability: BROKER_CAPABILITY.STORAGE,
        method: BROKER_METHOD.SET,
        scope,
        payload: storagePayload(storageKind, storageScope, key, value),
      }),
    delete: (scope, key) =>
      invoke({
        capability: BROKER_CAPABILITY.STORAGE,
        method: BROKER_METHOD.DELETE,
        scope,
        payload: storagePayload(storageKind, storageScope, key),
      }),
    list: (scope) =>
      invoke({
        capability: BROKER_CAPABILITY.STORAGE,
        method: BROKER_METHOD.LIST,
        scope,
        payload: storagePayload(storageKind, storageScope),
      }),
  };
}

function createStorageKindSdk(storageKind) {
  return {
    global: createStorageScopeSdk(storageKind, STORAGE_SCOPE.GLOBAL),
    project: createStorageScopeSdk(storageKind, STORAGE_SCOPE.PROJECT),
  };
}

function createOpenWaggleHostSdk() {
  return {
    state: {
      get: (scope) =>
        invoke({
          capability: BROKER_CAPABILITY.STATE,
          method: BROKER_METHOD.GET_STATE,
          scope,
          payload: {},
        }),
    },
    actions: {
      selectProject: (scope, projectPath) =>
        invoke({
          capability: BROKER_CAPABILITY.ACTIONS,
          method: BROKER_METHOD.SELECT_PROJECT,
          scope,
          payload: { projectPath },
        }),
      openExternal: (url) => {
        if (typeof url === 'string') {
          post({ type: 'open-external', url });
        }
        return Promise.resolve();
      },
    },
    settings: {
      get: (scope) =>
        invoke({
          capability: BROKER_CAPABILITY.SETTINGS,
          method: BROKER_METHOD.GET_SETTINGS,
          scope,
          payload: {},
        }),
      update: (scope, settings) =>
        invoke({
          capability: BROKER_CAPABILITY.SETTINGS,
          method: BROKER_METHOD.UPDATE_SETTINGS,
          scope,
          payload: settings,
        }),
    },
  };
}

function createExtensionSdk() {
  return {
    invoke,
    hostContext: {
      getScope: (scope) =>
        invoke({
          capability: BROKER_CAPABILITY.HOST_CONTEXT,
          method: BROKER_METHOD.GET_SCOPE,
          scope,
          payload: {},
        }),
    },
    storage: {
      packageState: createStorageKindSdk(STORAGE_KIND.STATE),
      packageConfig: createStorageKindSdk(STORAGE_KIND.CONFIG),
    },
    openWaggle: createOpenWaggleHostSdk(),
  };
}

window.addEventListener('message', (event) => {
  if (event.source !== parent || !isFrameMessage(event.data, config.frameId)) {
    return;
  }

  if (event.data.type === 'dispose') {
    disposed = true;
    runCleanup();
    return;
  }

  if (event.data.type === 'invoke-result') {
    const resolve = pendingInvocations.get(event.data.requestId);
    if (!resolve) {
      return;
    }
    pendingInvocations.delete(event.data.requestId);
    resolve(event.data.result);
  }
});

window.addEventListener('pagehide', () => {
  disposed = true;
  runCleanup();
});

try {
  const extensionModule = await import(config.moduleUrl);
  if (
    !extensionModule ||
    typeof extensionModule !== 'object' ||
    typeof extensionModule.mount !== 'function'
  ) {
    throw new Error('Extension federated module must export a mount(context) function.');
  }

  const mountResult = await extensionModule.mount({
    ...config.context,
    root,
    sdk: createExtensionSdk(),
  });

  if (typeof mountResult === 'function') {
    cleanup = mountResult;
  }
  startResizeObserver();

  if (disposed) {
    runCleanup();
  } else {
    post({ type: 'mounted' });
  }
} catch (error) {
  const message = describeError(error);
  root.replaceChildren();
  const alert = document.createElement('div');
  alert.setAttribute('role', 'alert');
  alert.textContent = message;
  root.append(alert);
  post({ type: 'error', message });
}
`.trim()

export const EXTENSION_FRAME_BOOTSTRAP_SCRIPT_HASH =
  "'sha256-k4y4hf14weZzymCc0MTftNtopyh1/UycPtJVjpMbuVc='"
