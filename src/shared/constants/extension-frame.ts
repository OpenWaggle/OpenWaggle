export const EXTENSION_FRAME_MESSAGE_CHANNEL = 'openwaggle-extension-frame'

export const EXTENSION_FRAME_BOOTSTRAP_SCRIPT = `
const CHANNEL = 'openwaggle-extension-frame';

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
const pendingInvocations = new Map();

function post(message) {
  parent.postMessage({ channel: CHANNEL, frameId: config.frameId, ...message }, '*');
}

function runCleanup() {
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
    sdk: { invoke },
  });

  if (typeof mountResult === 'function') {
    cleanup = mountResult;
  }

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
  "'sha256-eIH7vE+gNH4voiA5w6zEXHTLalVDfYnQh0hrEIG7OA0='"
