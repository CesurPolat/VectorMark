interface PageDetails {
  title: string;
  url: string;
  favIconUrl: string;
}

const SHORTCUTS = {
  OPEN_POPUP: 'open-popup-shortcut',
  OPEN_SIDE_PANEL: 'open-side-panel-shortcut'
} as const;

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

  if (!(event.ctrlKey && event.shiftKey)) {
    return;
  }

  const key = (event.key || '').toLowerCase();

  if (key === 'd') {
    event.preventDefault();
    const message: ShortcutMessage = {
      type: SHORTCUTS.OPEN_POPUP,
      tabId: getCurrentTabIdHint(),
      page: collectPageDetails()
    };
    chrome.runtime.sendMessage(message);
    return;
  }

  if (key === 'o') {
    event.preventDefault();
    const message: ShortcutMessage = {
      type: SHORTCUTS.OPEN_SIDE_PANEL,
      tabId: getCurrentTabIdHint()
    };
    chrome.runtime.sendMessage(message);
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
