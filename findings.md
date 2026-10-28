# 事实记录

- 初始 `git status --short` 无输出；HEAD 为 `4ddea34`，包版本为 `0.2.0`。
- 英文 README 已引用三张 docs/preview*.png；缺少中文 README 与根目录截图元数据。
- 现有 npm 安装示例为未发布的 `dsh-git-bar@0.1.0`；本任务改为已存在的 Git 源，避免中文文档重复错误指引。
- 预览图为假数据渲染；不可替换为真实项目截图。隐私检查脚本只扫描 git tracked 文本，新增文件须暂存后再跑。
- 当前目录条目缺少 `screenshots`；卡片 `CardShot` 只读取该字段，README 图片回退仅在详情弹窗发生。源码：https://github.com/dsh-market/dsh-market/blob/main/src/client/MarketSection.tsx#L662-L683 。
- 新增根目录 screenshots.json，复用三张假数据图；新增完整中文 README，英文入口互链，package.json 包含两份文档和截图清单。
- 资源验证真实输出：`README.md: local links OK`、`README.zh.md: local links OK`；三张 PNG 均为 `HTTP 200 image/png`，大小依次为 56395、95524、128906 字节。
- `npm pack --dry-run --json --cache /tmp/dsh-git-bar-npm-cache` 退出 0；包内共 20 项，包含 README.zh.md、screenshots.json 和三张预览图。
- `npm test` 退出 0：`ALL HOST TESTS PASSED`、`ALL CLIENT TESTS PASSED`、`ALL INTERACTION TESTS PASSED`。
- 市场截图规则：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md#screenshots--截图optional-recommended--可选推荐 。推荐插件仓库根目录 screenshots.json，夜间构建采集；不再向目录的旧截图映射提交新条目。
