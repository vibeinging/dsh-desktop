import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const rendererRoot = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.dirname(rendererRoot)
const packageId = '@deepseek-ai/dsh-client-product-references'

export default defineConfig({
  root: rendererRoot,
  publicDir: false,
  build: {
    outDir: path.resolve(appRoot, 'packages/dsh-client-product-references/lib'),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(appRoot, 'packages/dsh-client-product-references/src/client/index.ts'),
      formats: ['cjs'],
      fileName: () => 'client.js'
    },
    rollupOptions: {
      external: [
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-client-runtime',
        '@deepseek-ai/dsh-client-ui-input-trigger'
      ],
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
