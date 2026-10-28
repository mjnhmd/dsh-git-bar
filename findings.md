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
- 参照实现 `KannaKuron/dsh-ide-git` 的 `src/client/git-graph.ts` 与 `xbzbing/dsh-git-panel` 的
  `src/client/Panel.tsx`：两者都是「lane 数组 + 每行边（into/out/pass）」的轻量布局，没有用第三方图库；
  本插件按同样思路自写 `layoutGraph`，不引入依赖。
- `conversation.view` 座位注册形状（从 `git-panel/src/client/index.ts:66-69` 抄的契约）：
  `ctx.slots.inject('conversation.view', () => ctx.slots.register({ name, id, order, locale, label: () => t('...') }, Component))`，
  组件从 props 拿 `sessionId`。
- 运行中的桌面端不会热加载插件 Host 半边：改动后 `curl http://127.0.0.1:53244/dsh-git-bar/log` 返回 404，
  而同机已有路由 `/dsh-git-bar/info` 返回 401（认证层），说明是「路由未注册」而不是「未授权」→ 必须重启应用。
- 该 GUI 需要 `dsh web` 打印的带 token 地址才能认证，`/` 直接访问返回
  `dsh web authentication required; reopen the URL printed by dsh web.`，所以命令行无法直接截图验证界面。

## 工作树「在此新建会话」报「该目录还不是工作区」（m00003）
- 报错来源：`client.js` 的 `openSessionIn(path)` 原先只在 `workspaces.list.getSnapshot().items`
  里按 `samePath(item.path, path)` 找已有工作区，找不到就返回 `'not-workspace'`，弹层据此渲染
  `worktree.notWorkspace`（「该目录还不是工作区」）。git worktree 目录默认不会出现在工作区注册表里，
  所以凡是非当前会话目录的工作树都必然命中这条错误——不是偶发。
- DSH 真实 API：Client 侧有 `workspaces.create({ path })`，host 侧按 realpath 去重（同一目录返回已有记录，
  不重复注册），拿到 `workspaceId` 后调 `uiWorkspace.openWorkspace(workspaceId)` 即建会话并导航。
  没有 `workspaces.create` 时按 `unsupported` 处理，不假装成功。
- 错误分类：host 抛 `workspace/invalid-path`（目录已不存在的场景，如 worktree 已被 `git worktree remove`）
  时返回 `'invalid-path'`，弹层显示 `worktree.invalidPath`「该目录已不存在，无法新建会话」；
  其余异常仍是 `unsupported`，并 `console.warn` 出原始 message。

## 用户反馈「面板滚不动 / 一加载更多就跳回顶部」（0.5.1 修复）
- 报错现象（用户实测，附截图）：①分支筛选面板鼠标滚轮不动；②滚到底自动加载更早提交后，列表跳回最顶部。
- ②的根因确实存在：`HistoryView` 的拉取副作用每次都以
  `setLog({ phase: 'loading', commits: [], hasMore: false, ... })` 开头，续页时把已渲染的提交清空，
  列表高度瞬间塌到 0，浏览器把 `scrollTop` 夹回顶部；新数据回来后用户已经站在列表最上方。
- 修复：用 `pageKey`（sessionId/dir/nonce/branch/author）+ `grownRef` 区分「续页」与「换筛选」，
  续页只把 `phase` 置为 `'more'` 并保留 `commits`，footer 显示读取中；换筛选才清空。
  `onListScroll` 与「一页装不满自动补页」两个副作用都只认 `phase === 'ready'`，所以 `'more'` 期间不会连环触发。
- ①的代码侧加固：原先的 `menu` 是 `position: absolute` 且祖先 `.view` 有 `overflow: hidden`，
  在矮窗口里会被裁掉一部分——被裁时列表看着在、滚轮却滚不动。现在打开面板时用
  `getBoundingClientRect()` 量按钮位置，改成 `position: fixed` 贴住按钮下沿（逃出 overflow 裁剪），
  并按「窗口高度 − 按钮下沿」收紧列表高度（`MENU_LIST_MAX = 240` 上限，最少 96px），
  `menuList` 也因此拿到了显式 `height`，不只靠 `maxHeight`。
- 附带的可用性修补：面板是浮动层，原先点空白处不收起，会一直盖住提交列表；现在监听 document `mousedown`，
  点到面板与 chip 之外就关闭。
- 待用户确认：0.5.0 是 11:16 推的，用户 11:19 反馈——若面板里已有搜索框，说明加载的是 0.5.0 之后的代码，
  但当时列表未被 240px 截断，怀疑桌面端仍在跑更早一次加载的模块实例。修复后需重启桌面端再验。

## 「提交到 300 笔就加载不动」根因（0.5.2）
- Client 续页是把 `page.limit` 每次 +60（60→120→…→360），Host `parseLimit()` 却钳到
  `MAX_LOG_LIMIT = 300`（`index.js:135`），所以 `limit=360` 与 `limit=300` 完全等价：
  每次返回同样 300 笔、`hasMore = commits.length > limit` 仍为 true，列表长度永远不涨；
  顶栏 `history.count` 显示的就是 `log.commits.length`，于是停在「300 笔提交」。
- 结论：`/log` 没有偏移量，靠放大 `limit` 天生撞天花板。修法是加 `skip` 参数 + 客户端累积续页，
  而不是把 `MAX_LOG_LIMIT` 调大（调大仍然是每页全量重传）。
- 注意 `git log --skip=N` 与 `--topo-order`、`--all` 可同时使用；续页之间若有新提交落地会错位，
  客户端按 hash 去重足以兜住。

## 筛选下拉滚不动（第五轮）
- 0.5.1 已把面板改成 `position: fixed` 并按窗口剩余高度收紧，但只要面板仍是「就地渲染」，
  祖先的 `transform` / `filter` / `contain` 都会把 fixed 变成相对那个祖先定位（再叠 `overflow:hidden` 就是裁掉），
  `getBoundingClientRect()` 量出来的视口坐标在缩放祖先里也不对。
- 现成参照：同机 `dsh-dream-skin/lib/client.js:3290` 的注释与 `dshmarket` 都明确「带 position:fixed 的浮层
  一律 `createPortal(…, document.body)` 离场」；`require('react-dom')` 在 Client 沙箱里可用。
- 因此本轮改为 portal + 上下翻转 + 显式高度；缺 `react-dom` 时就地渲染兜底（测试运行时就是这条路径）。

## 真 DOM 实测：就地 fixed 会被祖先拽走/裁掉（第六轮，headless Chrome）
用自己的 fixture（`--dump-dom` 取页面内 JS 写出来的测量结果）复现两种失败模式，两种面板都是
`position:fixed`、搜索框 32px + 列表 240px、按钮 rect 来自 `getBoundingClientRect()`：

| 祖先条件 | 就地渲染（修复前） | portal 到 body（修复后） |
|---|---|---|
| `transform` + `overflow:hidden`，host 在 y=0 高 300，按钮底边 215 | 面板 top 219，列表 240px 里**只有 47px 落在裁剪区内，完整可见 0 行** | 面板 top 219，列表 **240px 全部可见**，完整可见 7 行 |
| 同上但 host 挪到 `top:400px`（按钮底边 615） | 面板 top **1019**（被当成相对祖先定位，掉到 813px 视口外），可见 0px | 面板 top **619**，列表 134px 全可见，完整可见 3 行 |

- 结论：只要祖先带 `transform`/`filter`/`contain`，就地 `position:fixed` 就变成「相对祖先定位」，
  再叠 `overflow:hidden` 就是「只剩几个分支」甚至整块跑到屏外——用户报的「面板看得见、滚不动/只有几个」对得上。
- 这也解释了为什么只调高度、加 `overflow-y:auto` 治不好：坐标本身算错/被裁剪，滚动当然推不动。
- fixture 与脚本只留在系统临时目录（`/tmp/gitbar-dropdown/`），未入库。

## 真正的「滚不动」根因：行被压扁，列表永不溢出（第七轮，用户真机数据）
portal 修好之后用户仍报「筛分支面板不能滚动」，真机 Console 量到的数字把方向从「裁切」翻到「布局」：

```
inBody: true, panelPos: 'fixed', panelTop: 145, panelH: 283, viewportH: 820,
listH: 248, listClientH: 248, listScrollH: 248, overflowY: 'auto', scrollTopAfterSet150: 0
count: 14, rowH: 19, clientH: 248, scrollH: 248
```

- 面板已经 portal 到 `document.body`、完整落在视口内（top 145 + 283 < 820），**不是裁切问题**。
- `scrollHeight === clientHeight === 248` 说明列表内容没有溢出，所以既没有滚动条、`scrollTop` 也夹在 0。
- 但 `rowH` 只有 19px：正常行应是 `6px` 上下 padding + `18px` 行高 = 30px。14 × 17.14 = 240
  （240 + 8 padding = 248）——**行被 flex 收缩压到刚好铺满**，于是永远不溢出。

headless Chrome fixture 复现（14 行真实分支名、`max-height:248px; padding:4px`、行是 30px 按钮）：

| 行上的额外规则 | rowH | clientH | scrollH | scrollTop 设 200 后 |
|---|---|---|---|---|
| 无（裸结构） | 30 | 248 | 428 | 180 |
| `min-height: 0` | 17.14 | 248 | 248 | 0 |
| `overflow: hidden` | 17.14 | 248 | 248 | 0 |
| `min-height:0` + 列表改 `display:block` | 30 | 248 | 428 | 180 |
| `min-height:0` + 行加 `flexShrink:0` | 30 | 248 | 428 | 180 |
| 两者都加 | 30 | 248 | 428 | 180 |

- 机制：`menuList` 是 `display:flex; flex-direction:column` 且高度受限，行是 flex item。
  裸 DOM 里 `min-height:auto` 会把行托在内容高度、照常溢出成滚动；但宿主页面对 `button` 的复位
  带了 `min-height:0` / `overflow:hidden`（先验到其中任一即可），行的最小高度保护消失，
  flex 收缩把 14 行压缩成 240px 铺满，`scrollHeight` 恒等于 `clientHeight` —— 用户看到的就是「只有这几个分支、滚不动」。
- 修法（两处 `menuList` 一起改）：列表改 `display: block`（块级容器不会压缩子元素，结构上免疫），
  行再加 `flexShrink: 0`（局部兜底）。`historyStyles.menuList` 与 `styles.menuList` 同源同改。
- 上一轮用 20 行 × 30px 的 fixture 得出的「flex column 照样溢出、不会压扁」只在没有宿主 button 复位时成立，
  所以那一版 `display:block` 改动曾被我误判成非必要并回滚——现在的证据（真机 17.14px + 两种复位各自复现）才支持它。

## 分支筛选只列本地分支（第八轮）
- 用户：「这个项目里边有非常多的分支 应该是没拉全」+「搜索也要支持搜索全部分支 不只是本地分支 包括提交人也是」。
  真机数据是 `count: 14`（「全部分支」+ 13 个本地分支），而 `readBranches()` 只读 `refs/heads`，
  远端分支一个都没进来 —— 活跃仓库的分支大半只存在于远端，所以是「没拉全」。
- 搜索本身没问题：`filterChip()` 对下拉里的**全部选项**做 `label.toLowerCase().includes(needle)`，
  没有条数上限；作者侧本来就走 `/authors`（`git log --all` 全历史）。缺的只是分支数据。
- 修法：Host 新增 `readRemotes(dir)`（`for-each-ref --format='%(refname:short)%00%(symref)' refs/remotes`，
  `%(symref)` 非空的是 `origin/HEAD` 这类符号引用、跳过；排序后 `MAX_REMOTES = 500` 截断并回报 `remotesTruncated`），
  `/branches` 回复新增 `remotes` / `remotesTruncated`；Client 把 `body.remotes` 接在本地分支之后塞进筛选选项。
- `remotes` 只用于提交历史筛选：`/log?branch=origin/feat-x` 走的是 `git log <revision>`（`args.push(filters.branch)`），
  `validBranchFilter()` 的 `BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/` 接受这种名字；切换/新建分支仍只看 `branches`，语义不变。
