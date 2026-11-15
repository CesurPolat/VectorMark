interface PageDetails {
  title: string;
  url: string;
  favIconUrl: string;
}

const SHORTCUTS = {
  OPEN_POPUP: 'open-popup-shortcut',
  OPEN_SIDE_PANEL: 'open-side-panel-shortcut'
} as const;

const DEFAULT_SIDE_PANEL_SHORTCUT = 'Alt+Shift+O';
const DEFAULT_POPUP_SHORTCUT = 'Ctrl+Shift+D';
const usesNativePopupShortcut = Boolean(chrome.runtime.getManifest().commands?.['_execute_action']);
const usesNativeSidebarShortcut = Boolean(chrome.runtime.getManifest().commands?.['toggle-sidebar']);
let sidePanelShortcut = DEFAULT_SIDE_PANEL_SHORTCUT;
let popupShortcut = DEFAULT_POPUP_SHORTCUT;

chrome.storage?.local?.get(['vectormarkSettings'], (result) => {
  const settings = result?.vectormarkSettings as { sidePanelShortcut?: string; popupShortcut?: string } | undefined;
  popupShortcut = settings?.popupShortcut || DEFAULT_POPUP_SHORTCUT;
  sidePanelShortcut = settings?.sidePanelShortcut && settings.sidePanelShortcut !== 'Ctrl+Shift+O'
    ? settings.sidePanelShortcut : DEFAULT_SIDE_PANEL_SHORTCUT;
});

chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.vectormarkSettings?.newValue) {
    return;
  }

  const nextSettings = changes.vectormarkSettings.newValue as { sidePanelShortcut?: string; popupShortcut?: string };
  popupShortcut = nextSettings.popupShortcut || DEFAULT_POPUP_SHORTCUT;
  sidePanelShortcut = nextSettings.sidePanelShortcut && nextSettings.sidePanelShortcut !== 'Ctrl+Shift+O'
    ? nextSettings.sidePanelShortcut : DEFAULT_SIDE_PANEL_SHORTCUT;
});

type ShortcutMessage =
  | {
      type: typeof SHORTCUTS.OPEN_POPUP;
      tabId: null;
      page: PageDetails;
    }
  | {
      type: typeof SHORTCUTS.OPEN_SIDE_PANEL;
      tabId: null;
    };

window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.repeat) {
    return;
  }

  if (!usesNativeSidebarShortcut && matchesShortcut(event, sidePanelShortcut)) {
    event.preventDefault();
    const message: ShortcutMessage = {
      type: SHORTCUTS.OPEN_SIDE_PANEL,
      tabId: getCurrentTabIdHint()
    };
    chrome.runtime.sendMessage(message);
    return;
  }

  if (!usesNativePopupShortcut && matchesShortcut(event, popupShortcut)) {
    event.preventDefault();
    const message: ShortcutMessage = {
      type: SHORTCUTS.OPEN_POPUP,
      tabId: getCurrentTabIdHint(),
      page: collectPageDetails()
    };
    chrome.runtime.sendMessage(message);
    return;
  }

}, true);

function collectPageDetails(): PageDetails {
  const iconLink = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');

  return {
    title: document.title || '',
    url: window.location.href,
    favIconUrl: iconLink ? iconLink.href : ''
  };
}

function getCurrentTabIdHint(): null {
  // Content scripts cannot directly read tabId, background can resolve sender.tab.id.
  return null;
}

function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+');
  const key = parts[parts.length - 1]?.toLowerCase();

  const eventKey = event.key === ' ' ? 'space' : (event.key || '').toLowerCase();
  if (!key || eventKey !== key) {
    return false;
  }

  return parts.includes('Ctrl') === event.ctrlKey
    && parts.includes('Alt') === event.altKey
    && parts.includes('Shift') === event.shiftKey
    && parts.includes('Meta') === event.metaKey;
}
