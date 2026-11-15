import * as local from './dbServiceLocal';
import { createDatabaseClient } from './databaseBridge';

export { resolveBookmarkIconPayload, resolveBookmarkIconData } from './iconService';

// Firefox private extension documents cannot open IndexedDB. The spanning
// background document owns the normal collection and executes these requests.
const client = createDatabaseClient(local, chrome);

export const updateBookmark = client.updateBookmark;
export const saveOrUpdateBookmarkByUrl = client.saveOrUpdateBookmarkByUrl;
export const deleteBookmark = client.deleteBookmark;
export const deleteBookmarkByUrl = client.deleteBookmarkByUrl;
export const countBookmarks = client.countBookmarks;
export const listBookmarksPageWithIcons = client.listBookmarksPageWithIcons;
export const searchBookmarksPage = client.searchBookmarksPage;
export const isUrlExist = client.isUrlExist;
export const getBookmarkByUrl = client.getBookmarkByUrl;
export const recordBookmarkClick = client.recordBookmarkClick;
export const moveBookmarkInCustomOrder = client.moveBookmarkInCustomOrder;
export const moveFolderInCustomOrder = client.moveFolderInCustomOrder;
export const reorderBookmarksInScope = client.reorderBookmarksInScope;
export const reorderFoldersInScope = client.reorderFoldersInScope;
export const listBookmarksPageWithSort = client.listBookmarksPageWithSort;
export const listChildFoldersWithSort = client.listChildFoldersWithSort;
export const createFolder = client.createFolder;
export const listFolders = client.listFolders;
export const getFolderById = client.getFolderById;
export const listChildFolders = client.listChildFolders;
export const listFolderAncestors = client.listFolderAncestors;
export const renameFolder = client.renameFolder;
export const deleteFolder = client.deleteFolder;
export const updateFolder = client.updateFolder;
