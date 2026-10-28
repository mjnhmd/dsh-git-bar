# 进度

## 已完成
- 定位插件仓库，核对工作区、版本和假数据预览图。
- 确认卡片依赖目录 screenshots 字段；README 图片只为详情弹窗提供回退。
- 新增截图清单与完整中文 README，补英文入口、准确安装说明和打包清单。
- 本地 Markdown 链接、三张远端 PNG、打包清单及 Host / Client / 交互测试通过。

## 本地交付
- 暂存新增文件后 `npm run check` 输出：`隐私检查通过：30 个文件，无命中`。
- 最终 diff 已检查，`git diff --cached --check` 退出 0；本阶段文件一起本地提交，提交号以 `git log -1 --oneline` 核实。

## Git 历史标签页（本轮）
- 已完成：Host 三条只读路由（`/log`、`/commit`、`/commit-diff`）+ 40–48 号用例；
- 已完成：Client 分叉图谱（`layoutGraph` 纯函数 + `GraphCell` SVG）、提交列表/过滤、提交详情、
  逐文件 diff，注册到主对话区 `conversation.view`；
- 已完成：中英 README 补功能说明与三条路由，`package.json` 升到 `0.3.0`；
- 已验证：`npm run check`、`npm test`（Host 48 / Client 17 / 交互 9）、真仓库端到端契约核对通过；
- 待用户操作：运行中的桌面端仍加载旧版插件（`/dsh-git-bar/log` 实测 404），需重启 DSH 后才能看到标签页。

## 分支 / 提交人筛选 + 滚动续页（本轮）
- 已完成：`/log` 支持 `branch` / `author` 参数（在 git 里 `rev-list <ref>` 取提交集，
  再按 committer date 排序分页，`total` 是筛选后的真实总数）；非法参数 400
  `{reason:'invalid-branch'|'invalid-author'}`；
- 已完成：客户端筛选栏（分支、提交人两个浮层下拉，带搜索框），筛选变化后重置分页；
  去掉「加载更多」按钮，改滚到底部自动续页，列表不足一屏时自动再取一页；
- 已完成：`client.js` 改用真实存在的 DSH 主题 token（原来的 `--dsw-alias-state-success`
  等名字在 app.asar 里不存在，之前颜色全部走 fallback）；
- 已完成：README 中英、`docs/market/index.json` 描述、`locale/{zh,en}.json` 同步，
  `package.json` 升到 `0.4.0`，预览图按新模板重画（假数据，加了两个下拉）；
- 已验证：`npm run check`（31 文件无命中）、`npm test`（Host 52 / Client 21 / 交互 11）、
  真 git 仓库端到端核对（筛选结果与 `git log` 逐条一致、越界页返回空列表、滚到底续页去重）；
- 世界索引 200 行已被 0.3.0 覆盖过，0.4.0 条目追加在尾部（升序）。

## 工作树「在此新建会话」修复（本轮）
- 根因：`openSessionIn` 只在工作区注册表快照里找已有目录，找不到就返回 `not-workspace`，
  而 git worktree 默认没注册成工作区；
- 已完成：改为 `workspaces.create({ path })`（host 侧 realpath 幂等）→ `uiWorkspace.openWorkspace(workspaceId)`；
  新增 `invalid-path` 分支（目录已删除时提示「该目录已不存在，无法新建会话」，弹层留在原地），
  删掉不再使用的 `samePath` 与 `worktree.notWorkspace` 文案；
- 已完成：`test/interaction.test.mjs` 补 `workspaces.create` mock 与三条分支（已注册 / 未注册 / 目录已删），
  断言 requests 序列 `create:/repo`、`open:ws-1`、`create:/repo-hotfix`、`open:ws-3`；
- 已完成：README 中英同步「未注册目录会先注册成工作区」；
- 已验证：`npm run check`（31 文件无命中）、`npm test`（Host 52 / Client 21 / 交互 15 步全绿，
  实测输出 `1 worktree popover OK: 4 rows`、`2 open actions OK: 3`、`3 worktree session OK: 5 host calls`）。

## 下一步
等用户重启桌面端确认「在此新建会话」真的在该 worktree 里开出会话，确认后再单独授权推送。

## 边界
用户尚未授权本次推送；远端仍是 0.3.0。市场卡片要等社区目录每日构建采集。

## 「面板滚不动 / 加载更多跳回顶部」修复（0.5.1）
- 已完成：续页不再清空 `commits`（`pageKey` + `grownRef` 区分续页/换筛选），`phase: 'more'` 期间保留行并显示页脚读取中；
- 已完成：筛选面板改 `position: fixed` 并按窗口剩余高度收紧（上限 240px、下限 96px），列表有显式 `height`；
- 已完成：点面板外自动收起；
- 已完成：交互测试新增 `13b`（续页保留行、页脚从 loading 回到 idle）与 `14b`（锚定位置、窗口 900 时 240px、窗口 300 时 116px），
  实测 `ALL INTERACTION TESTS PASSED`（16 步）。
- 待确认：重启桌面端后，面板能否用滚轮滚、滚到底续页是否还跳顶。
- 未授权：本轮改动未推送。

## 「提交列表卡 300 / 筛选下拉滚不动」修复（本轮，未发版）
- 已完成：`/log` 加 `skip` 偏移量（Host `parseSkip` + `readLog(..., skip)` + `--skip=N`），
  客户端每页固定问 60 笔、滚到底按「已加载笔数」当 `skip` 续页并累积去重，续页失败保留已加载行；
  上限 `HISTORY_MAX_COMMITS = 3000` 时列表底部提示「缩小筛选范围」。
- 已完成：筛选面板改为 `portalToBody()` 离场到 `document.body`（缺 `react-dom` 就地渲染兜底），
  下方放不下 `MENU_LIST_MIN + 40` 时翻到按钮上方，列表高度按 `room - 40` 取 `[120, 240]`。
- 已完成：README 中英 `/log` 契约补 `skip`，`index.js` 路由注释同步。
- 已验证：`npm run check`（隐私检查 31 文件无命中）、`npm test` 全绿 —— Host 新增
  `42b log skip paging OK 400 commits over 7 pages`，交互新增 `16 skip paging OK: 130 commits over 3 pages`、
  `14c panel flips above the chip OK`、`14d panel portal OK`，`14b` 短窗口断言 116px → 120px。
- 已验证：headless Chrome fixture 实测「就地 fixed 被祖先裁剪/拽出视口，portal 后全可见」（数据见 findings.md）。
- 下一步：重启桌面端（`127.0.0.1:50467`）后确认提交列表能滚过 300、筛选下拉能用滚轮滚到底。
- 未做：`package.json` 仍是 0.5.1，未升版本、未动市场索引、未推送（发版另行授权）。

## 筛选下拉「滚不动」真因修复（第七轮）
- 已定位：不是裁切（portal 已生效、面板完整在视口内），而是 `menuList` 作为 flex column 时，
  宿主对 `button` 的复位（`min-height:0` / `overflow:hidden`）让行失去最小高度保护、被压到 17.14px 铺满，
  `scrollHeight` 恒等于 `clientHeight` → 没有滚动条、滚轮无效。
- 已修改：`historyStyles.menuList`、`styles.menuList` 改 `display: block`；两处 `menuItem` 加 `flexShrink: 0`。
- 已验证：`npm run check` + `npm test` 全绿；交互测试 `5`、`14` 新增「列表是块级容器 + 行不压缩」断言；
  headless Chrome fixture 覆盖「无复位 / min-height:0 / overflow:hidden」三种条件（数据见 findings.md）。
- 待确认：重启桌面端后下拉能否滚到底；用户反馈「项目分支很多、只拉到 14 个」——需确认是否要列远端分支。
- 未做：未升版本、未推送。

## 分支筛选补上远端分支（第八轮）
- 已完成：Host `readRemotes()` + `/branches` 回复新增 `remotes` / `remotesTruncated`（`origin/HEAD` 这类符号引用跳过，上限 500）。
- 已完成：Client 筛选选项 = 本地分支 + 远端分支（`origin/x` 排在本地之后），搜索框因此能搜到只存在于远端的分支；
  作者搜索本来就走 `/authors` 全历史，不受当前页限制。
- 已验证：host 新增 `14b remote branches OK 2 commits on origin/feature`（造 `origin/feature` + `origin/HEAD` 符号引用，
  断言只列出真分支、`/log?branch=origin/feature` 能用）；交互新增 `17 search covers every option OK`
  （搜 `FEAT` 命中 `origin/feat-x`、搜 `zoe` 命中只在 `/authors` 里的 Zoe）；`npm run check` + `npm test` 全绿。
- 待确认：重启桌面端后分支下拉能否看到远端分支、能否滚到底。
- 未做：未升版本、未推送。

## 提交详情显示分支名、可选中复制（第九轮）
- 已完成：Host `readCommit()` 增返回 `refs`（`git show -s --decorate=full --format=%D` + `parseRefs()`）；
  Client 详情面板在作者行下面渲染「分支 / 标签」一行，chip 按 kind 上色、全名不截断、可拖选复制；
  无引用时不渲染空行。中英 README 的 `/commit` 契约与历史页描述同步；`docs/preview-history.png` 重渲染。
- 已验证：`npm run check`（隐私检查 31 文件无命中）+ `npm test` 全绿；Host 新增 `44b commit refs OK
  head:main, local:feature/x, tag:v1`；交互新增 `8b no-refs commit OK` 与详情 chip 的 `userSelect/text` 断言。
- 待确认（要用户操作）：**Host 半要重启 DSH 桌面端**才生效（插件是 `link:` 进 desktop profile，Host 代码在进程里），
  然后刷新页面才能看到详情里的分支名。
- 未做：未升版本、未推送。
