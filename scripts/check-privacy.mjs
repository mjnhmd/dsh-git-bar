/**
 * 公开仓库的防线：不许把真实项目名、内部代号写进这个仓库。
 *
 * 词表用 base64 存着，解码后再匹配 —— 否则这个文件本身就成了那份清单的明文。
 * 只扫纳入版本控制的文本文件；截图之类由 `scripts/render-previews.mjs` 用假数据渲染，
 * 从源头上就没有真实信息。
 *
 *   node scripts/check-privacy.mjs
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/** 需要挡住的词，base64 编码后保存。 */
const DENIED = [
  'eGlhb2Jhbmtl',
  'eGhz',
  'Y291cnNl',
  '5bCP57qi5Lmm',
  '5bCP54+t6K++',
  'eW91ZGFv',
  '5pyJ6YGT',
].map((encoded) => Buffer.from(encoded, 'base64').toString('utf8'))

/** 二进制/图片后缀：扫字面量没有意义。 */
const BINARY = /\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|zip|gz|tgz|pdf)$/i

/** 这个文件自己就带着词表（编码形式），跳过。 */
const SELF = 'scripts/check-privacy.mjs'

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((file) => file !== '' && file !== SELF && !BINARY.test(file))

const offenders = []
for (const file of files) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  const haystack = text.toLowerCase()
  for (const word of DENIED) {
    const index = haystack.indexOf(word.toLowerCase())
    if (index === -1) continue
    const line = text.slice(0, index).split('\n').length
    offenders.push(`${file}:${line} 命中「${word}」`)
  }
}

if (offenders.length > 0) {
  console.error('公开仓库里出现了不该出现的词：')
  for (const offender of offenders) console.error(`  ${offender}`)
  process.exit(1)
}
console.log(`隐私检查通过：${files.length} 个文件，无命中`)
