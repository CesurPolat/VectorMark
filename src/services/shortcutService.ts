export const DEFAULT_SIDE_PANEL_SHORTCUT = 'Alt+Shift+O';
export const DEFAULT_POPUP_SHORTCUT = 'Ctrl+Shift+D';

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];

function titleCaseKey(key: string): string {
  if (key === ' ') {
    return 'Space';
  }

  if (key.length === 1) {
    return key.toUpperCase();
  }

  return key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): string | null {
  const key = titleCaseKey(event.key || '');

  if (!key || ['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    return null;
  }

  const modifiers: string[] = [];

  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Meta');

  if (modifiers.length === 0) {
    return null;
  }

  return [...modifiers, key].join('+');
}

export function normalizeShortcut(value: unknown, fallback = DEFAULT_SIDE_PANEL_SHORTCUT): string {
  const raw = String(value ?? '').trim();

  if (!raw || (fallback === DEFAULT_SIDE_PANEL_SHORTCUT && raw === 'Ctrl+Shift+O')) {
    return fallback;
  }

  const parts = raw.split('+').map(part => part.trim()).filter(Boolean);
  const key = parts.pop();

  if (!key || !parts.some(part => MODIFIER_ORDER.includes(part))) {
    return fallback;
  }

  const modifiers = MODIFIER_ORDER.filter(modifier => parts.includes(modifier));
  return [...modifiers, titleCaseKey(key)].join('+');
}

export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  return shortcutFromKeyboardEvent(event) === normalizeShortcut(shortcut);
}
