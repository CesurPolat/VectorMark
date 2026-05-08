import $ from 'jquery';
import '@fortawesome/fontawesome-free/js/all.min.js';
// @ts-ignore
import 'bulma/css/bulma.min.css';

import {
  deleteBookmarkByUrl,
  saveOrUpdateBookmarkByUrl,
  resolveBookmarkIconPayload,
  listFolders,
  getBookmarkByUrl
} from '../services/dbService';
import { getSettings } from '../services/settingsService';
import type { IconPayload } from '../types';

interface SourceTabContext {
  tabId: number | null;
  title: string;
  url: string;
  favIconUrl: string;
}

let selectedFolderId: string | null = null;

function normalizeId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

$(document).ready(async function () {
  const source = await resolveSourceTabContext();
  const currentUrl = source.url;

  $("#title-input").val(source.title);
  $("#icon-img").attr("src", source.favIconUrl);

  const existing = await getBookmarkByUrl(currentUrl);
  if (existing) {
    selectedFolderId = existing.folderId;
    $("#title-input").val(existing.title);
  }

  await populateFolders();

  if (selectedFolderId !== null) {
    // We already set selectedFolderId, let's make sure populateFolders highlights it
  }

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

  $(document).on("click", "#folder-list-container .dropdown-item", function (e) {
    e.preventDefault();
    const id = $(this).data("id");
    const name = $(this).find("span:last").text();

    selectedFolderId = (id === "null" || id === null) ? null : normalizeId(id);

    // Update UI
    $("#folder-list-container .dropdown-item").removeClass("is-active");
    $(this).addClass("is-active");
    $("#folder-drp .dropdown-trigger button span:first").text(name);
    $("#folder-drp").removeClass("is-active");
  });

  $("#other-bookmarks-btn").click(async function () {
    if (source.tabId) {
      await chrome.sidePanel.open({ tabId: source.tabId });
    }
    window.close();
  });

});

async function populateFolders(): Promise<void> {
  try {
    const folders = await listFolders({ sortBy: 'name', sortDir: 'asc' });
    const $list = $("#dynamic-folder-list");
    $list.empty();

    // Reset indicator
    $("#folder-list-container .dropdown-item").removeClass("is-active");

    if (selectedFolderId === null) {
      $("#folder-list-container .dropdown-item[data-id='null']").addClass("is-active");
      $("#folder-drp .dropdown-trigger button span:first").text("All Bookmarks");
    }

    folders.forEach(f => {
      const isSelected = f.id === selectedFolderId;
      const item = $(`
        <a href="#" class="dropdown-item${isSelected ? ' is-active' : ''}" data-id="${f.id}">
          <span class="icon is-small"><i class="fas fa-folder"></i></span>
          <span>${escapeHtml(f.name)}</span>
        </a>
      `);
      $list.append(item);

      if (isSelected) {
        $("#folder-drp .dropdown-trigger button span:first").text(f.name);
        $("#folder-list-container .dropdown-item[data-id='null']").removeClass("is-active");
      }
    });
  } catch (error) {
    console.error('Error populating folders:', error);
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function resolveSourceTabContext(): Promise<SourceTabContext> {
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

function isSupportedUrl(url: string): boolean {
  return typeof url === 'string' && (url.startsWith('http') || url.startsWith('file'));
}

function getInputValue(selector: string): string {
  return String($(selector).val() ?? '').trim();
}

async function saveBookmark(url: string, data: string): Promise<void> {
  const settings = await getSettings();
  const iconPayload: IconPayload = await resolveBookmarkIconPayload(url, data, {
    storageMode: settings.iconStorageMode,
    skipPageHtmlLookup: true
  });

  await saveOrUpdateBookmarkByUrl(
    getInputValue('#title-input'),
    url,
    selectedFolderId,
    iconPayload
  );
}

function markAsSaved(): void {
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
