export const BROWSER_PREVIEW_ELEMENT_PICKER_FOUNDATION = `
(() => {
  const STATE_KEY = '__openwaggleBrowserPreviewElementPicker';
  const OVERLAY_ATTRIBUTE = 'data-openwaggle-browser-annotation-ui';
  const MAX_ELEMENTS = 20;
  const MAX_REGIONS = 20;
  const MAX_STROKES = 20;
  const MAX_STROKE_POINTS = 256;
  const MAX_STACK_FRAMES = 16;
  const MAX_MARQUEE_CANDIDATES = 800;
  const MAX_MARQUEE_SAMPLES = 196;
  const MAX_TEXT = 500;
  const MAX_SELECTOR = 2048;
  const MAX_HTML = 4000;
  const MAX_STYLES = 4000;
  const MAX_SOURCE = 2048;
  const MAX_SOURCE_POSITION = 10000000;
  const MAX_COMPONENT = 256;
  const MAX_STYLE_VALUE = 512;
  const CAPTURE_PADDING = 20;
  const MIN_REGION_SIZE = 3;
  const DEFAULT_STROKE_WIDTH = 4;
  const MAX_STROKE_WIDTH = 24;
  const MIN_POINT_DISTANCE = 2;
  const CONTENT_Z_INDEX = 1;
  const CHROME_Z_INDEX = 10;
  const OVERLAY_Z_INDEX = 2147483646;
  const STYLE_PROPERTIES = [
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'color',
    'background-color',
    'opacity',
    'border-radius',
    'border-color',
    'border-style',
    'border-width',
    'width',
    'height',
    'padding',
    'margin',
    'gap',
  ];
  const CONTEXT_STYLE_PROPERTIES = [
    'display',
    'position',
    'width',
    'height',
    'margin',
    'padding',
    'gap',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'color',
    'background-color',
    'border',
    'border-radius',
    'opacity',
  ];

  const previous = globalThis[STATE_KEY];
  if (previous && typeof previous.cancel === 'function') previous.cancel();

  return new Promise((resolve) => {
    let settled = false;
    let tornDown = false;
    let idSequence = 0;
    let tool = 'select';
    let dragStart = null;
    let activeStroke = null;
    let editorExpanded = false;
    let editorPosition = null;
    let editorDrag = null;
    let layoutFrame = null;
    let editorWasShown = false;
    let drawColor = '#3b82f6';
    let drawWidth = DEFAULT_STROKE_WIDTH;

    const selected = new Map();
    const regions = [];
    const strokes = [];
    const styleChanges = new Map();
    const targetNodes = new Map();
    const toolButtons = new Map();

    const host = document.createElement('div');
    host.setAttribute(OVERLAY_ATTRIBUTE, '');
    host.style.cssText = [
      'all:initial',
      'position:fixed',
      'inset:0',
      'z-index:' + String(OVERLAY_Z_INDEX),
      'pointer-events:none',
      'color-scheme:dark',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    ].join(';');
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = [
      ':host{--ow-accent:#60a5fa;--ow-accent-strong:#2563eb;--ow-bg:#0f172a;--ow-panel:#111827;--ow-input:#020617;--ow-border:#475569;--ow-fg:#f8fafc;--ow-muted:#94a3b8}',
      '*{box-sizing:border-box}',
      '.root{position:fixed;inset:0;pointer-events:none;color:var(--ow-fg);font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
      '.box{position:fixed;display:none;box-sizing:border-box;border:2px solid var(--ow-accent);border-radius:3px;background:rgba(37,99,235,.12);pointer-events:none}',
      '.target-label{position:fixed;max-width:280px;overflow:hidden;padding:2px 6px;border-radius:4px;background:var(--ow-accent-strong);color:white;font:600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;text-overflow:ellipsis;pointer-events:none}',
      '.ink{position:fixed;inset:0;overflow:visible;pointer-events:none}',
      '.toolbar{position:fixed;top:10px;left:50%;display:flex;align-items:center;gap:2px;transform:translateX(-50%);padding:4px;border:1px solid var(--ow-border);border-radius:8px;background:rgba(15,23,42,.96);box-shadow:0 10px 30px rgba(0,0,0,.3);pointer-events:auto;backdrop-filter:blur(12px)}',
      '.toolbar-separator{width:1px;height:20px;margin:0 3px;background:var(--ow-border)}',
      '.status{max-width:150px;padding:0 6px;color:var(--ow-muted);font:11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      'button{appearance:none;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--ow-fg);font:500 12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}',
      'button:hover{background:#1e293b}',
      'button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--ow-accent);outline-offset:1px}',
      'button.tool{height:30px;padding:0 9px}',
      'button.tool[aria-pressed=true]{background:rgba(96,165,250,.16);color:#93c5fd}',
      'button.icon{display:grid;width:30px;height:30px;place-items:center;color:var(--ow-muted);font-size:16px}',
      'button.primary{height:32px;padding:0 12px;border-color:var(--ow-accent-strong);background:var(--ow-accent-strong);color:white}',
      'button.primary:hover{background:#1d4ed8}',
      'button:disabled{cursor:not-allowed;opacity:.5}',
      '.draw-options{display:none;align-items:center;gap:5px;padding:0 4px}',
      '.draw-options[data-visible=true]{display:flex}',
      '.draw-options input[type=color]{width:24px;height:24px;padding:1px;border:1px solid var(--ow-border);border-radius:5px;background:var(--ow-input)}',
      '.draw-options input[type=range]{width:72px;accent-color:var(--ow-accent)}',
      '.editor{position:fixed;display:none;width:min(380px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:hidden;border:1px solid var(--ow-border);border-radius:10px;background:rgba(15,23,42,.97);box-shadow:0 18px 48px rgba(0,0,0,.38);pointer-events:auto;backdrop-filter:blur(12px)}',
      '.composer{display:flex;align-items:flex-start;gap:7px;padding:8px}',
      '.composer textarea{min-width:0;min-height:32px;max-height:96px;flex:1;resize:none;overflow-y:hidden;padding:6px 2px;border:0;border-bottom:1px solid transparent;background:transparent;color:var(--ow-fg);font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
      '.composer textarea::placeholder{color:var(--ow-muted)}',
      '.composer textarea:focus{border-bottom-color:var(--ow-accent);outline:0}',
      '.drag{display:none;width:24px;height:32px;color:var(--ow-muted);cursor:grab;font-size:17px}',
      '.editor[data-expanded=true] .drag{display:block}',
      '.style-panel{display:none;max-height:min(330px,calc(100vh - 150px));overflow:auto;padding:4px 10px 10px;border-top:1px solid var(--ow-border);background:rgba(2,6,23,.3)}',
      '.editor[data-expanded=true] .style-panel[data-has-elements=true]{display:block}',
      '.style-section{display:grid;gap:5px;padding:8px 0;border-bottom:1px solid rgba(71,85,105,.7)}',
      '.style-section:last-child{border-bottom:0}',
      '.field{display:grid;min-height:28px;grid-template-columns:92px minmax(0,1fr);align-items:center;gap:8px;color:var(--ow-muted);font-size:11px;font-weight:600}',
      '.field input:not([type=color]):not([type=range]),.field select{width:100%;height:28px;min-width:0;padding:0 7px;border:1px solid var(--ow-border);border-radius:5px;background:var(--ow-input);color:var(--ow-fg);font:11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace}',
      '.color-control{display:grid;grid-template-columns:26px minmax(0,1fr);align-items:center;gap:4px;padding:2px;border:1px solid var(--ow-border);border-radius:5px;background:var(--ow-input)}',
      '.color-control input[type=color]{width:22px;height:22px;padding:0;border:0;border-radius:4px;background:transparent}',
      '.color-control input[type=text]{height:22px!important;padding:0 3px!important;border:0!important}',
      '.hint{margin:0;padding:6px 10px 0;color:var(--ow-muted);font-size:11px}',
      '.limit{color:#fbbf24}',
    ].join('');

    const root = document.createElement('div');
    root.className = 'root';
    root.setAttribute(OVERLAY_ATTRIBUTE, '');
    const hoverBox = document.createElement('div');
    hoverBox.className = 'box';
    hoverBox.style.zIndex = String(CONTENT_Z_INDEX);
    const marqueeBox = document.createElement('div');
    marqueeBox.className = 'box';
    marqueeBox.style.zIndex = String(CONTENT_Z_INDEX);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ink');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', '0 0 ' + String(Math.max(1, window.innerWidth)) + ' ' + String(Math.max(1, window.innerHeight)));
    svg.style.zIndex = String(CONTENT_Z_INDEX);
    root.append(hoverBox, marqueeBox, svg);

    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.style.zIndex = String(CHROME_Z_INDEX);
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Preview annotation tools');
    const drawOptions = document.createElement('div');
    drawOptions.className = 'draw-options';
    const drawColorInput = document.createElement('input');
    drawColorInput.type = 'color';
    drawColorInput.value = drawColor;
    drawColorInput.title = 'Drawing color';
    drawColorInput.setAttribute('aria-label', 'Drawing color');
    const drawWidthInput = document.createElement('input');
    drawWidthInput.type = 'range';
    drawWidthInput.min = '1';
    drawWidthInput.max = String(MAX_STROKE_WIDTH);
    drawWidthInput.value = String(drawWidth);
    drawWidthInput.title = 'Drawing width';
    drawWidthInput.setAttribute('aria-label', 'Drawing width');
    drawOptions.append(drawColorInput, drawWidthInput);
    const toolbarSeparator = document.createElement('span');
    toolbarSeparator.className = 'toolbar-separator';
    const status = document.createElement('span');
    status.className = 'status';
    status.setAttribute('aria-live', 'polite');
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'icon';
    cancelButton.textContent = '×';
    cancelButton.title = 'Cancel annotation (Escape)';
    cancelButton.setAttribute('aria-label', 'Cancel annotation');

    const editor = document.createElement('div');
    editor.className = 'editor';
    editor.style.zIndex = String(CHROME_Z_INDEX);
    editor.setAttribute(OVERLAY_ATTRIBUTE, '');
    editor.setAttribute('data-expanded', 'false');
    const composer = document.createElement('div');
    composer.className = 'composer';
    const expandButton = document.createElement('button');
    expandButton.type = 'button';
    expandButton.className = 'icon';
    expandButton.textContent = '☷';
    expandButton.title = 'Expand style editor';
    expandButton.setAttribute('aria-label', 'Expand style editor');
    expandButton.setAttribute('aria-expanded', 'false');
    const comment = document.createElement('textarea');
    comment.maxLength = MAX_TEXT;
    comment.rows = 1;
    comment.placeholder = 'Describe the change…';
    comment.setAttribute('aria-label', 'Annotation comment');
    const dragHandle = document.createElement('button');
    dragHandle.type = 'button';
    dragHandle.className = 'drag';
    dragHandle.textContent = '⠿';
    dragHandle.title = 'Drag annotation editor';
    dragHandle.setAttribute('aria-label', 'Drag annotation editor');
    const attachButton = document.createElement('button');
    attachButton.type = 'button';
    attachButton.className = 'primary';
    attachButton.textContent = 'Attach';
    attachButton.title = 'Attach annotation and screenshot (Enter)';
    composer.append(expandButton, comment, dragHandle, attachButton);
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Shift-click adds elements. Enter attaches. Esc cancels.';
    const stylePanel = document.createElement('div');
    stylePanel.className = 'style-panel';
    stylePanel.setAttribute('data-has-elements', 'false');
    editor.append(composer, hint, stylePanel);
    root.append(toolbar, editor);
    shadow.append(style, root);
    document.documentElement.append(host);

    const cursorStyle = document.createElement('style');
    cursorStyle.setAttribute(OVERLAY_ATTRIBUTE, '');
    cursorStyle.textContent = 'html[data-openwaggle-annotation-tool] body,html[data-openwaggle-annotation-tool] body *{cursor:crosshair!important}';
    document.documentElement.append(cursorStyle);

`
