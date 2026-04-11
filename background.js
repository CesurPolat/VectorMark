import { isUrlExist } from '../services/dbService.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch((error) => {
    console.error('Error setting side panel behavior on install:', error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch((error) => {
    console.error('Error setting side panel behavior on startup:', error);
  });
});


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
    const tabId = sender?.tab?.id;

    if (!tabId) {
      return;
    }

    chrome.sidePanel.setOptions({ tabId, enabled: true }).then(() => {
      return chrome.sidePanel.open({ tabId });
    }).catch((error) => {
      console.error('Error opening side panel from shortcut script:', error);
    });

    return;
  }

  if (message.type === 'close-side-panel') {
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const activeTab = tabs?.[0];

      if (!activeTab?.id) {
        return;
      }

      return chrome.sidePanel.setOptions({
        tabId: activeTab.id,
        enabled: false
      });
    }).catch((error) => {
      console.error('Error closing side panel:', error);
    });

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
