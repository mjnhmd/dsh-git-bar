// 用 DSH 自带的索引校验器（和插件页「发现」读到的是同一套规则）检查一份格式 1 索引。
// 用法： ELECTRON_RUN_AS_NODE=1 "<DSH 可执行文件>" scripts/validate-index.mjs docs/market-index.example.json
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const CANDIDATES = [
  process.env.DSH_MARKET_INDEX_PKG,
  '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js',
].filter(Boolean)

const file = CANDIDATES.find((p) => p && fs.existsSync(p))
if (file === undefined) {
  console.error('找不到 dsh-plugin-market-index，设置 DSH_MARKET_INDEX_PKG 指向它的 lib/index.js')
  process.exit(2)
}
const { parseMarketIndex, marketInstallTarget } = await import(file)

const target = process.argv[2]
if (target === undefined) {
  console.error('用法: validate-index.mjs <index.json>')
  process.exit(2)
}
const raw = fs.readFileSync(target, 'utf8').replaceAll('PUT_40_HEX_COMMIT_SHA_HERE', 'a'.repeat(40))
const index = parseMarketIndex(JSON.parse(raw), process.env.DSH_INDEX_URL ?? 'https://example.com/market/index.json')
for (const plugin of index.plugins) {
  console.log(`${plugin.name} — ${plugin.versions.length} 个版本: ${plugin.versions.map((v) => v.version).join(', ')}`)
  console.log(`  默认版本安装参数: ${JSON.stringify(marketInstallTarget(plugin.name, plugin.versions[0]))}`)
}
console.log('索引格式校验通过')
