export const BROWSER_PREVIEW_ELEMENT_PICKER_LIFECYCLE = `
    const onPointerMove = (event) => {
      if (isOverlayEvent(event)) {
        hoverBox.style.display = 'none';
        return;
      }
      const point = { x: event.clientX, y: event.clientY };
      if (tool === 'select' && !dragStart) {
        const target = targetAt(point.x, point.y);
        if (target) positionBox(hoverBox, rectFromDomRect(target.getBoundingClientRect()));
        else hoverBox.style.display = 'none';
        return;
      }
      hoverBox.style.display = 'none';
      if (tool === 'marquee' && dragStart) {
        positionBox(marqueeBox, normalizeRect(dragStart, point));
      } else if (tool === 'draw' && activeStroke) {
        appendStrokePoint(activeStroke.target, point);
        activeStroke.path.setAttribute('d', pathFromPoints(activeStroke.target.points));
      }
    };
    const onPointerDown = (event) => {
      if (event.button !== 0 || isOverlayEvent(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = { x: event.clientX, y: event.clientY };
      if (tool === 'select') {
        const target = targetAt(point.x, point.y);
        if (target) toggleSelected(target, event.shiftKey);
        return;
      }
      if (tool === 'erase') {
        removeTargetAtPoint(point);
        return;
      }
      dragStart = point;
      if (tool === 'draw') beginStroke(point);
    };
    const onPointerUp = (event) => {
      if (!dragStart) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = { x: event.clientX, y: event.clientY };
      if (tool === 'marquee') {
        const rect = boundedRect(normalizeRect(dragStart, point));
        marqueeBox.style.display = 'none';
        if (rect.width >= MIN_REGION_SIZE && rect.height >= MIN_REGION_SIZE) {
          if (selectElementsInRect(rect) === 0) addRegion(rect);
        }
      } else if (tool === 'draw' && activeStroke) {
        appendStrokePoint(activeStroke.target, point);
        if (activeStroke.target.points.length > 1) strokes.push(activeStroke.target);
        else {
          activeStroke.path.remove();
          targetNodes.delete(activeStroke.target.id);
        }
        activeStroke = null;
      }
      dragStart = null;
      updateStatus();
    };
    const onClick = (event) => {
      if (isOverlayEvent(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const removeListeners = () => {
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', repaint, true);
      window.removeEventListener('resize', repaint);
      window.removeEventListener('blur', onBlur);
    };
    const cleanup = () => {
      if (tornDown) return;
      tornDown = true;
      removeListeners();
      if (layoutFrame !== null) window.cancelAnimationFrame(layoutFrame);
      for (const target of selected.values()) restoreTargetStyles(target);
      document.documentElement.removeAttribute('data-openwaggle-annotation-tool');
      cursorStyle.remove();
      host.remove();
      if (globalThis[STATE_KEY] === state) delete globalThis[STATE_KEY];
    };
    const cancel = () => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
      cleanup();
    };
    const completeCapture = () => cleanup();
    const onBlur = () => {
      hoverBox.style.display = 'none';
    };
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
        return;
      }
      if (isOverlayEvent(event)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      const key = event.key.toLowerCase();
      const nextTool = key === 'v' ? 'select' : key === 'r' ? 'marquee' : key === 'd' ? 'draw' : key === 'e' ? 'erase' : null;
      if (!nextTool) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      tool = nextTool;
      refreshTool();
    }
    const submit = () => {
      if (settled || selected.size + regions.length + strokes.length === 0) return;
      const elements = [];
      for (const target of selected.values()) {
        if (!target.element.isConnected) continue;
        elements.push({
          id: target.id,
          element: contextFor(target.element),
          rect: boundedRect(rectFromDomRect(target.element.getBoundingClientRect())),
        });
      }
      const captureRect = unionRects([
        ...elements.map((target) => target.rect),
        ...regions.map((region) => region.rect),
        ...strokes.map((stroke) => stroke.bounds),
      ]);
      if (!captureRect) return;
      settled = true;
      removeListeners();
      toolbar.style.display = 'none';
      editor.style.display = 'none';
      hoverBox.style.display = 'none';
      marqueeBox.style.display = 'none';
      resolve({
        version: 2,
        pageUrl: String(location.href).slice(0, 8192),
        pageTitle: String(document.title || '').slice(0, 512),
        comment: cleanText(comment.value, MAX_TEXT),
        elements,
        regions: regions.slice(0, MAX_REGIONS),
        strokes: strokes.slice(0, MAX_STROKES),
        styleChanges: Array.from(styleChanges.values()).slice(0, MAX_ELEMENTS * STYLE_PROPERTIES.length),
        captureRect,
      });
    };
    const resizeComment = () => {
      comment.style.height = 'auto';
      const heightValue = Math.min(comment.scrollHeight, 96);
      comment.style.height = String(heightValue) + 'px';
      comment.style.overflowY = comment.scrollHeight > 96 ? 'auto' : 'hidden';
      queueEditorLayout();
    };

    comment.addEventListener('input', resizeComment);
    editor.addEventListener('keydown', (event) => {
      event.stopImmediatePropagation();
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      submit();
    });
    expandButton.addEventListener('click', () => {
      if (selected.size === 0) return;
      editorExpanded = !editorExpanded;
      editor.setAttribute('data-expanded', editorExpanded ? 'true' : 'false');
      expandButton.setAttribute('aria-expanded', editorExpanded ? 'true' : 'false');
      expandButton.setAttribute('aria-label', editorExpanded ? 'Collapse style editor' : 'Expand style editor');
      expandButton.title = editorExpanded ? 'Collapse style editor' : 'Expand style editor';
      if (editorExpanded) {
        const rect = editor.getBoundingClientRect();
        editorPosition = { left: rect.left, top: rect.top };
        syncStyleControls();
      } else editorPosition = null;
      queueEditorLayout();
    });
    dragHandle.addEventListener('pointerdown', (event) => {
      if (!editorExpanded || event.button !== 0) return;
      const rect = editor.getBoundingClientRect();
      editorDrag = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };
      dragHandle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    dragHandle.addEventListener('pointermove', (event) => {
      if (!editorDrag || editorDrag.pointerId !== event.pointerId) return;
      editorPosition = {
        left: event.clientX - editorDrag.offsetX,
        top: event.clientY - editorDrag.offsetY,
      };
      queueEditorLayout();
      event.preventDefault();
    });
    const finishEditorDrag = (event) => {
      if (!editorDrag || editorDrag.pointerId !== event.pointerId) return;
      editorDrag = null;
      if (dragHandle.hasPointerCapture(event.pointerId)) dragHandle.releasePointerCapture(event.pointerId);
      event.preventDefault();
    };
    dragHandle.addEventListener('pointerup', finishEditorDrag);
    dragHandle.addEventListener('pointercancel', finishEditorDrag);
    attachButton.addEventListener('click', submit);
    cancelButton.addEventListener('click', cancel);
    drawColorInput.addEventListener('input', () => {
      if (/^#[0-9a-f]{6}$/iu.test(drawColorInput.value)) drawColor = drawColorInput.value;
    });
    drawWidthInput.addEventListener('input', () => {
      const value = Number(drawWidthInput.value);
      if (Number.isFinite(value)) {
        drawWidth = Math.max(1, Math.min(MAX_STROKE_WIDTH, Math.round(value)));
      }
    });
    document.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
    document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: false });
    document.addEventListener('pointerup', onPointerUp, { capture: true, passive: false });
    document.addEventListener('pointercancel', onPointerUp, { capture: true, passive: false });
    document.addEventListener('click', onClick, { capture: true, passive: false });
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', repaint, { capture: true, passive: true });
    window.addEventListener('resize', repaint, { passive: true });
    window.addEventListener('blur', onBlur);
    const state = { cancel, completeCapture };
    globalThis[STATE_KEY] = state;
    refreshTool();
    updateStatus();
  });
})()
`
