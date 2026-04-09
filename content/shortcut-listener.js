const SHORTCUTS = {
  OPEN_POPUP: 'open-popup-shortcut',
  OPEN_SIDE_PANEL: 'open-side-panel-shortcut'
};

window.addEventListener('keydown', (event) => {
  if (event.repeat) {
    return;
  }

  if (!(event.ctrlKey && event.shiftKey)) {
    return;
  }

  const key = (event.key || '').toLowerCase();

  if (key === 'd') {
    event.preventDefault();
    chrome.runtime.sendMessage({
      type: SHORTCUTS.OPEN_POPUP,
      tabId: getCurrentTabIdHint(),
      page: collectPageDetails()
    });
    return;
  }

  if (key === 'o') {
    event.preventDefault();
    chrome.runtime.sendMessage({
      type: SHORTCUTS.OPEN_SIDE_PANEL,
      tabId: getCurrentTabIdHint()
    });
  }
}, true);

function collectPageDetails() {
  const iconLink = document.querySelector('link[rel~="icon"]');

  return {
    title: document.title || '',
    url: window.location.href,
    favIconUrl: iconLink ? iconLink.href : ''
  };
}

function getCurrentTabIdHint() {
  // Content scripts cannot directly read tabId, background can resolve sender.tab.id.
  return null;
}
