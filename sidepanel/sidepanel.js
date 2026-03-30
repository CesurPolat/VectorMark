import { listBookmarksWithIcons } from '../services/dbService.js';

$(document).ready(async () => {
    try {
        const bookmarks = await listBookmarksWithIcons();
        const $list = $('#bookmarks-list');
        
        if (bookmarks.length === 0) {
            $list.append('<p>No bookmarks found.</p>');
            return;
        }

        bookmarks.forEach(bookmark => {
            const iconHtml = bookmark.icon ? 
                `<img src="${bookmark.icon.base64}" style="width: 16px; height: 16px; margin-right: 8px;">` : 
                '<span class="icon is-small px-3" style="margin-right: 8px;"><i class="fas fa-bookmark"></i></span>';
            
            const item = $(`
                <div class="box mb-2 p-3">
                    <div class="media">
                        <div class="media-left">
                            ${iconHtml}
                        </div>
                        <div class="media-content">
                            <a href="${bookmark.url}" target="_blank" class="has-text-weight-semibold">${bookmark.title}</a>
                        </div>
                    </div>
                </div>
            `);
            $list.append(item);
        });
    } catch (error) {
        console.error('Error loading bookmarks:', error);
        $('#bookmarks-list').html('<p class="has-text-danger">Error loading bookmarks.</p>');
    }
});
