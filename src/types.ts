export type ViewMode = 'list' | 'grid';
export type IconStorageMode = 'base64' | 'url';
export type SortDirection = 'asc' | 'desc';
export type SortFields = 'customOrder' | 'updatedAt' | 'createdAt' | 'lastClickedAt' | 'title' | 'name' | 'id';

export interface Settings {
  openInNewTab: boolean;
  pageSize: number;
  viewMode: ViewMode;
  iconStorageMode: IconStorageMode;
  bookmarkSortBy: SortFields;//TODO: Remove
  bookmarkSortDir: SortDirection;
  folderSortBy: SortFields;//TODO: Remove
  folderSortDir: SortDirection;
  manualOrderEnabled: boolean;
}

export type PartialSettingsInput = Partial<Settings>;

export interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
  customOrder: number;
  bookmarkCount?: number;
}

export interface IconRow {
  id: string;
  data: string;
  hash: string;
}

export interface BookmarkRecord {
  id: string;
  title: string;
  url: string;
  folderId: string | null;
  iconId: string | null;
  createdAt: number;
  updatedAt: number;
  lastClickedAt: number | null;
  customOrder: number;
}

export interface BookmarkWithIcon extends BookmarkRecord {
  icon: IconRow | null;
}

export interface BookmarkImportItem {
  title: string;
  url: string;
  folderPath: string;
}

export interface IconPayload {
  data: string;
  hash: string | null;
}

export interface QueryOptions {
  rootOnly?: boolean;
  sortBy?: SortFields;
  sortDir?: SortDirection;
}

export interface SearchBookmarksPageResult {
  items: BookmarkWithIcon[];
  total: number;
}

export interface SaveOrUpdateBookmarkResult {
  bookmarkId: string;
  action: 'created' | 'updated';
}

export interface NormalizeIconsProgress {
  stage: 'start' | 'convert' | 'merge' | 'done';
  total: number;
  processed: number;
  failed?: number;
  summary?: NormalizeIconsSummary;
}

export interface NormalizeIconsSummary {
  total: number;
  converted: number;
  detached: number;
  reattached: number;
  deleted: number;
  failed: number;
}

export interface DatabaseExportPayload {
  version: number;
  exportedAt: string;
  data: {
    folders: FolderRecord[];
    icons: IconRow[];
    bookmarks: BookmarkRecord[];
  };
}
