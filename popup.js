$(document).ready(function () {

  $("#done-btn").click(function () {
    chrome.action.setBadgeText({ text: " " });
    chrome.action.setBadgeBackgroundColor({ color: "#7af93b" });
    window.close();
  });

  $("#remove-btn").click(function () {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setBadgeBackgroundColor({ color: [0, 0, 0, 0] });
    window.close();
  });

  $("#folder-drp").click(function () {
    $(this).toggleClass("is-active");
  });

});

  // Aktif sekmeyi al
  //const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Script çalıştır
  /* 
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => (document.body.style.backgroundColor = "lightblue")
  }); 
  */

  // Side paneli aç
  //await chrome.sidePanel.open({ tabId: tab.id });

  // Yer imlecinleri al
  /* 
  chrome.bookmarks.getTree((bookmarkTreeNodes) => {
    console.log(bookmarkTreeNodes);
  }); 
  */