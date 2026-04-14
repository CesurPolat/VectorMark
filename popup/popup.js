import { deleteBookmarkByUrl, saveOrUpdateBookmarkByUrl } from '../services/dbService.js';


$(document).ready(async function () {
  const source = await resolveSourceTabContext();
  const currentUrl = source.url;

  $("#title-input").val(source.title);
  $("#icon-img").attr("src", source.favIconUrl);

  if (isSupportedUrl(currentUrl)) {
    try {
      await saveBookmark(currentUrl, source.favIconUrl);
      markAsSaved();
    } catch (error) {
      console.error('Error auto-saving bookmark:', error);
    }
  }

  $("#done-btn").click(async function () {
    if (!isSupportedUrl(currentUrl)) {
      window.close();
      return;
    }

    try {
      await saveBookmark(currentUrl, source.favIconUrl);
      markAsSaved();

      window.close();
    } catch (error) {
      console.error('Error saving bookmark:', error);
    }
  });

  $("#remove-btn").click(async function () {
    try {
      await deleteBookmarkByUrl(currentUrl);
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
    if (source.tabId) {
      await chrome.sidePanel.open({ tabId: source.tabId });
    }
    window.close();
  });

});

async function resolveSourceTabContext() {
  const params = new URLSearchParams(window.location.search);
  const sourceTabIdParam = params.get('sourceTabId');

  const contextFromParams = {
    tabId: sourceTabIdParam ? Number(sourceTabIdParam) : null,
    title: params.get('title') || '',
    url: params.get('url') || '',
    favIconUrl: params.get('favIconUrl') || ''
  };

  if (contextFromParams.url) {
    return contextFromParams;
  }

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  return {
    tabId: activeTab?.id ?? null,
    title: activeTab?.title ?? '',
    url: activeTab?.url ?? '',
    favIconUrl: activeTab?.favIconUrl ?? ''
  };
}

function isSupportedUrl(url) {
  return typeof url === 'string' && (url.startsWith('http') || url.startsWith('file'));
}

async function saveBookmark(url, data) {
  await saveOrUpdateBookmarkByUrl(
    $("#title-input").val(),
    url,
    null,
    data
  );
}

function markAsSaved() {
  chrome.action.setBadgeText({ text: " " });
  chrome.action.setBadgeBackgroundColor({ color: "#7af93b" });
}

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