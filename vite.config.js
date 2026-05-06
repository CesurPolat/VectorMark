import { defineConfig } from 'vite'

export default defineConfig({
    build: {
        rollupOptions: {
            input: {
                popup: 'src/popup/popup.html',
                sidepanel: 'src/sidepanel/sidepanel.html',
                settings: 'src/settings/settings.html',
                background: 'src/background.js',
                shortcutListener: 'src/content/shortcut-listener.js',
            },
            output: {
                entryFileNames: '[name].js'
            }
        },
        outDir: 'dist'
    }
})