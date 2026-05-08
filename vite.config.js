import { defineConfig } from 'vite'

export default defineConfig({
    resolve: {
        extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json']
    },
    build: {
        rollupOptions: {
            input: {
                popup: 'src/popup/popup.html',
                sidepanel: 'src/sidepanel/sidepanel.html',
                settings: 'src/settings/settings.html',
                background: 'src/background.js',
                shortcutListener: 'src/content/shortcut-listener.ts',
            },
            output: {
                entryFileNames: '[name].js'
            }
        },
        outDir: 'dist'
    }
})
