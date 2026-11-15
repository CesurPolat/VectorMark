import { isUrlExist } from './services/dbService';

import { getSettings } from './services/settingsService';

const panelPorts = new Map();
chrome.runtime.onConnect.addListener(port => {
  if (!port.name.startsWith('vectormark-panel:')) return;
  const windowId = Number(port.name.split(':')[1]);
  panelPorts.set(windowId, port);
  port.onDisconnect.addListener(() => {
    if (panelPorts.get(windowId) === port) panelPorts.delete(windowId);
  });
});

const sidebarAction = globalThis.browser?.sidebarAction || chrome.sidebarAction;

function isFirefoxSidebar() {
  return typeof sidebarAction?.open === 'function';
}

function openOrToggleSidebar() {
  if (!isFirefoxSidebar()) {
    return null;
  }

  if (typeof sidebarAction.toggle === 'function') {
    return sidebarAction.toggle();
  }

  return sidebarAction.open();
}

chrome.runtime.onInstalled.addListener(() => {
  if (typeof chrome.sidePanel?.setPanelBehavior === 'function') {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch((error) => {
      console.error('Error setting side panel behavior on install:', error);
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  if (typeof chrome.sidePanel?.setPanelBehavior === 'function') {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch((error) => {
      console.error('Error setting side panel behavior on startup:', error);
    });
  }
});

if (isFirefoxSidebar()) {
  chrome.commands.onCommand.addListener(command => {
    if (command === 'toggle-sidebar') {
      openOrToggleSidebar().catch(error => console.error('Could not toggle sidebar:', error));
    }
  });
  getSettings().then(settings => globalThis.browser.commands.update({
    name: 'toggle-sidebar', shortcut: settings.sidePanelShortcut
  })).catch(error => console.error('Could not configure sidebar shortcut:', error));
}


// When url changes, update badge
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {

  chrome.tabs.get(details.tabId).then((tab) => {
    if (tab.active) {
      badgeUpdate(details.url, " ");// H for History
    }
  });

});

// When a new page is loaded, update badge
chrome.webNavigation.onCommitted.addListener((details) => {

  chrome.tabs.get(details.tabId).then((tab) => {
    if (tab.active) {
      badgeUpdate(details.url, " ");// L for Loaded
    }
  });

});

// When tab is activated, update badge
chrome.tabs.onActivated.addListener((activeInfo) => {

  chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const activeTab = tabs[0];
    badgeUpdate(activeTab.url, " ");// A for Activated
  });

});

function badgeUpdate(_url, _status) {

  // Only process http, https, file URLs
  if (!(_url.startsWith("http") || _url.startsWith("file"))) return;

  // Ignore specific URL
  if (_url == "https://accounts.youtube.com/RotateCookiesPage?origin=https://www.youtube.com&yt_pid=1") return;

  // Log the URL and status
  console.log(`URL: ${_url} | Status: ${_status}`);

  isUrlExist(_url).then(exists => {
    if (exists) {
      chrome.action.setBadgeText({ text: _status });
      chrome.action.setBadgeBackgroundColor({ color: "#7af93b" });
    }
    else {
      chrome.action.setBadgeText({ text: "" });
      // chrome.action.setBadgeBackgroundColor({ color: "#ff0000" });
    }
  });



}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message?.type) {
    return;
  }

  if (message.type === 'open-side-panel-shortcut') {
    if (isFirefoxSidebar()) return;

    const tabId = sender?.tab?.id;

    if (tabId == null || typeof chrome.sidePanel?.open !== 'function') {
      return;
    }

    const windowId = sender.tab.windowId;
    if (panelPorts.has(windowId)) {
      const closing = typeof chrome.sidePanel.close === 'function'
        ? chrome.sidePanel.close({ windowId })
        : chrome.sidePanel.setOptions({enabled: false})
          .then(() => chrome.sidePanel.setOptions({enabled: true}));
      closing.catch(error => console.error('Could not close side panel:', error));
      return;
    }

    chrome.sidePanel.open({ windowId }).catch(error => console.error('Could not open side panel:', error));
    return;
  }

  if (message.type === 'open-popup-shortcut') {
    const windowId = sender?.tab?.windowId;

    chrome.action.openPopup(
      windowId ? { windowId } : undefined
    ).catch((error) => {
      console.error('Error opening action popup from shortcut script:', error);
    });
  }
});
