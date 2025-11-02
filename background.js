// When url changes, update badge
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {

  chrome.tabs.get(details.tabId).then((tab) => {
    if(tab.active) {
      badgeUpdate(details.url, "H");
    }
  });
  
});

// When a new page is loaded, update badge
chrome.webNavigation.onCommitted.addListener((details) => {

  chrome.tabs.get(details.tabId).then((tab) => {
    if(tab.active) {
      badgeUpdate(details.url, "L");
    }
  });

});

// When tab is activated, update badge
chrome.tabs.onActivated.addListener((activeInfo) => {

  chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const activeTab = tabs[0];
    badgeUpdate(activeTab.url, "A");
  });
  
});

function badgeUpdate(_url, _status) {

  // Only process http, https, file URLs
  if(!(_url.startsWith("http") || _url.startsWith("file"))) return;

  // Ignore specific URL
  if(_url == "https://accounts.youtube.com/RotateCookiesPage?origin=https://www.youtube.com&yt_pid=1") return;

  // Log the URL and status
  console.log(`URL: ${_url} | Status: ${_status}`);

  if (_url.includes("short")) {
    chrome.action.setBadgeText({ text: _status });
    chrome.action.setBadgeBackgroundColor({ color: "#7af93b" });
  }
  else {
    chrome.action.setBadgeText({ text: _status });
    chrome.action.setBadgeBackgroundColor({ color: "#ff0000" });
  }

}
