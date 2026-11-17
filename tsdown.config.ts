import { builtinModules } from 'node:module'
import { defineConfig } from 'tsdown'

/**
 * 双产物配置（结构抄自 dsh-novel 的 tsdown.config.ts，机制相同、取舍相同）。
 *
 * **平台模块表**：宿主 web shell 的 `staticModules()` 把这些 specifier 种进冻结的浏览器
 * 模块表，client bundle 里遇到它们要留给注入的 `require`，不能 inline。表必须**比运行时表窄**
 * ——多收一条就是给「构建通过、浏览器 require 落空」放行。本挂件只用得到 react 族与 cordis。
 */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis',
]
const isRequested = (s: string): boolean => PLATFORM_MODULES.includes(s)
const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((id) => `node:${id}`)])
const NODE_ENV = process.env.NODE_ENV ?? 'production'

export default defineConfig([
  {
    // Node 半：ESM node。它只 import type cordis，产物近乎空壳。
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
    deps: {
      onlyBundle: false,
      neverBundle: (s) => s.startsWith('@deepseek-ai/'),
      alwaysBundle: (s) => !s.startsWith('@deepseek-ai/'),
    },
  },
  {
    // 浏览器半：CJS 单文件闭合工厂（宿主 `./client` 导出契约的三段式 banner/intro/footer）
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      onlyBundle: false,
      neverBundle: isRequested,
      alwaysBundle: (s) => !isRequested(s),
    },
    define: {
      'process.env': '{}',
      'process.env.NODE_ENV': JSON.stringify(NODE_ENV),
      'import.meta.env.MODE': JSON.stringify(NODE_ENV),
      'import.meta.env': JSON.stringify({ MODE: NODE_ENV }),
      'import.meta.resolve': 'undefined',
    },
    inputOptions: {
      resolve: { conditionNames: ['browser', 'import', 'require', 'default'] },
    },
    plugins: [{
      // 构建期纯度门：@deepseek-ai/* 值 import 不在平台表 → 构建失败；
      // Node 内建闯进浏览器 bundle 同理必炸
      name: 'dsh-novel-widget-bundle-purity',
      resolveId(source: string) {
        if (NODE_BUILTINS.has(source)) {
          throw new Error(`client bundle purity: Node 内建 "${source}" 不能进浏览器模块表`)
        }
        if (!source.startsWith('@deepseek-ai/')) return null
        if (isRequested(source)) return null
        throw new Error(
          `client bundle purity: "${source}" 不在平台模块表——跨插件值 import 被禁；跨插件协作走 HTTP / cordis 服务`,
        )
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify('@xrn1997/dsh-novel-widget')}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
