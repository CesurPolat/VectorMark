$(document).ready(async function () {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  $("#title-input").val(tab.title);
  $("#icon-img").attr("src", tab.favIconUrl);

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

  $("#other-bookmarks-btn").click(async function () {
    await chrome.sidePanel.open({ tabId: tab.id });
    window.close();
  });

});

  // Script çalıştır
  /* 
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => (document.body.style.backgroundColor = "lightblue")
  }); 
  */

  // Yer imlecinleri al
  /* 
  chrome.bookmarks.getTree((bookmarkTreeNodes) => {
    console.log(bookmarkTreeNodes);
  }); 
  */