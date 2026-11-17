/**
 * 产物自检（不需要宿主）：这一条挡的是「构建成功但装上去不认」。
 *
 * 钉四件事——任何一件错了，宿主都会在装载期或渲染期静默失败：
 * 1. `lib/client.js` 是宿主要求的**三段式 CJS 工厂**，且 id 是包名本身
 * 2. 浏览器 bundle 没有 require 平台模块表之外的 `@deepseek-ai/*`
 * 3. `lib/index.js` 导出 `apply`（否则插件树装载失败）
 * 4. `cordis.patch.yml` 的 insert 行 name 与包名一致
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name: string
  main: string
  exports: Record<string, unknown>
  dsh: { bundle: { patch: string }; client: { platform: string } }
}

describe('packaging', () => {
  it('package.json 声明 bundle patch 与 web client', () => {
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(pkg.dsh.client.platform).toBe('web')
    expect(pkg.main).toBe('lib/index.js')
  })

  it('cordis.patch.yml 挂的行名就是包名', () => {
    const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain(`name: '${pkg.name}'`)
    expect(patch).toContain('- insert:')
  })

  it('client bundle 是闭合工厂，id 等于包名', () => {
    const code = readFileSync(join(root, 'lib/client.js'), 'utf8')
    expect(code.startsWith('window.__ModuleLoader__.load({')).toBe(true)
    expect(code).toContain(`id: ${JSON.stringify(pkg.name)}`)
    // 末尾是 `//# sourceMappingURL=...` 注释，所以不能直接断言「以 }); 结尾」
    expect(code.trimEnd()).toMatch(/\}\);(\s*\/\/# sourceMappingURL=\S+)?$/)
    // 宿主注入的 require 契约：模块里不能自带模块系统
    expect(code).toContain('factory: (require) => {')
  })

  it('client bundle 只 require 平台模块表里的东西', () => {
    const code = readFileSync(join(root, 'lib/client.js'), 'utf8')
    const required = [...code.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]!)
    const allowed = new Set([
      'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
      '@deepseek-ai/cordis',
    ])
    for (const spec of new Set(required)) {
      expect(allowed.has(spec), `unexpected require: ${spec}`).toBe(true)
    }
  })

  it('Node 半导出 apply 与 name', () => {
    const code = readFileSync(join(root, 'lib/index.js'), 'utf8')
    expect(code).toContain('function apply')
    expect(code).toContain(`const name = ${JSON.stringify(pkg.name)}`)
  })
})
