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
