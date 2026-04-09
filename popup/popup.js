import { addBookmarkWithIcon, deleteBookmarkByUrl } from '../services/dbService.js';


$(document).ready(async function () {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  $("#title-input").val(tab.title);
  $("#icon-img").attr("src", tab.favIconUrl);

  $("#done-btn").click(async function () {
    try {
      await addBookmarkWithIcon(
        $("#title-input").val(),
        tab.url,
        null,
        tab.favIconUrl
      );

      chrome.action.setBadgeText({ text: " " });
      chrome.action.setBadgeBackgroundColor({ color: "#7af93b" });

      window.close();
    } catch (error) {
      console.error('Error saving bookmark:', error);
    }
  });

  $("#remove-btn").click(async function () {
    try {
      await deleteBookmarkByUrl(tab.url);
    } catch (error) {
      console.error('Error removing bookmark:', error);
    }

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