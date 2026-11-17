import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 纯函数测在 node 里跑得更快；组件测用文件头的 environment docblock 切到 jsdom
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    globals: true,
  },
})
