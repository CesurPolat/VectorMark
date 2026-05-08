import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
    resolve: {
        extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json']
    },
    build: {
        rollupOptions: {
            input: {
                popup: resolve(__dirname, 'src/popup/popup.html'),
                sidepanel: resolve(__dirname, 'src/sidepanel/sidepanel.html'),
                settings: resolve(__dirname, 'src/settings/settings.html'),
                background: resolve(__dirname, 'src/background.js'),
                shortcutListener: resolve(__dirname, 'src/content/shortcut-listener.ts'),
            },
            output: {
                entryFileNames: '[name].js'
            }
        },
        outDir: 'dist'
    }
})
