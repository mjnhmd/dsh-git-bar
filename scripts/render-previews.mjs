/**
 * 重新生成 docs/ 里的预览图。
 *
 * 预览图是用假数据（acme-storefront / feat/retry-policy）画出来的，不截真机屏幕：
 * 真机截图会带上工作区列表、会话标题、真实分支名和内部文件名，推到公开仓库就是泄露。
 *
 *   node scripts/render-previews.mjs
 */

import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pages = join(here, 'previews')
const docs = resolve(here, '..', 'docs')
const chrome =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const profile = join(process.env.TMPDIR ?? '/tmp', 'dsh-git-bar-previews')

/** 页面、窗口尺寸、输出文件。 */
const shots = [
  ['preview.html', '1472,300', 'preview.png'],
  ['branches.html', '1472,330', 'preview-branches.png'],
  ['changes.html', '772,520', 'preview-changes.png'],
  ['history.html', '1472,640', 'preview-history.png'],
]

if (!existsSync(chrome)) {
  console.error(`找不到 Chrome：${chrome}（用 CHROME_PATH 指一个）`)
  process.exit(1)
}

rmSync(profile, { recursive: true, force: true })
for (const [page, size, output] of shots) {
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-crashpad',
      '--disable-breakpad',
      `--user-data-dir=${profile}`,
      '--hide-scrollbars',
      '--default-background-color=FFFFFFFF',
      '--force-device-scale-factor=2',
      `--window-size=${size}`,
      `--screenshot=${join(docs, output)}`,
      `file://${join(pages, page)}`,
    ],
    { stdio: 'ignore' },
  )
  console.log(`wrote docs/${output}`)
}
rmSync(profile, { recursive: true, force: true })
