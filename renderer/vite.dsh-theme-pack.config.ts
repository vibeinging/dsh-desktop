import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const rendererRoot = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.dirname(rendererRoot)
const packageId = '@deepseek-ai/dsh-theme-pack'

export default defineConfig({
  root: rendererRoot,
  publicDir: false,
  build: {
    outDir: path.resolve(appRoot, 'packages/dsh-theme-pack/lib'),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(appRoot, 'packages/dsh-theme-pack/src/client/index.js'),
      formats: ['cjs'],
      fileName: () => 'client.js'
    },
    rollupOptions: {
      external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-theme'],
      output: {
        inlineDynamicImports: true,
        banner: [
          `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageId)}, factory: (require) => {`,
          'var module = { exports: {} }; var exports = module.exports;'
        ].join('\n'),
        footer: 'return module.exports; } });'
      }
    }
  }
})
