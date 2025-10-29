document.getElementById("changeColor").addEventListener("click", async () => {
  /* const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => (document.body.style.backgroundColor = "lightblue")
  }); */

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Side paneli bu sekmede aç
  await chrome.sidePanel.open({ tabId: tab.id });

    window.close();


  /* chrome.bookmarks.getTree((bookmarkTreeNodes) => {
    console.log(bookmarkTreeNodes);
  }); */
});
