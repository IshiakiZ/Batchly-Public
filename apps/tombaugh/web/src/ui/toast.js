// Tombaugh - SPHEREx blink comparator. Apache-2.0.
// AI-generated code: written by Claude (Anthropic) for team Missing Mass, NASA Space Apps 2026.

// Small, calm notifications at the bottom of the page.

/**
 * createToasts(container) -> { show(message, { kind, timeout, action, copyText }), clear() }
 * kind: 'info' | 'alert'. action: { label, onClick }. copyText adds a selectable field, used when
 * the clipboard is not available (sandboxed iframes).
 */
export function createToasts(container) {
  const doc = container.ownerDocument;
  const live = new Set();

  function dismiss(el) {
    if (!live.has(el)) return;
    live.delete(el);
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 180);
  }

  function show(message, { kind = 'info', timeout = 3600, action = null, copyText = null } = {}) {
    // Never stack more than three; drop the oldest.
    while (live.size >= 3) dismiss(live.values().next().value);
    const el = doc.createElement('div');
    el.className = `toast${kind === 'alert' ? ' is-alert' : ''}`;
    const text = doc.createElement('span');
    text.textContent = message;
    el.append(text);
    if (copyText) {
      const field = doc.createElement('input');
      field.type = 'text';
      field.readOnly = true;
      field.value = copyText;
      field.setAttribute('aria-label', 'Text to copy');
      field.addEventListener('focus', () => field.select());
      el.append(field);
      setTimeout(() => {
        try {
          field.focus();
          field.select();
        } catch {
          // ignore
        }
      }, 30);
    }
    if (action) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'toast-action';
      button.textContent = action.label;
      button.addEventListener('click', () => {
        dismiss(el);
        action.onClick();
      });
      el.append(button);
    }
    container.append(el);
    live.add(el);
    const ms = copyText ? Math.max(timeout, 12000) : timeout;
    if (ms > 0) setTimeout(() => dismiss(el), ms);
    return () => dismiss(el);
  }

  return {
    show,
    clear() {
      for (const el of [...live]) dismiss(el);
    },
  };
}

/** Copy text to the clipboard; resolves to true on success. Safe in sandboxed iframes. */
export async function copyText(text, doc = globalThis.document) {
  try {
    if (globalThis.navigator && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    doc.body.append(area);
    area.select();
    const ok = doc.execCommand('copy');
    area.remove();
    return !!ok;
  } catch {
    return false;
  }
}
