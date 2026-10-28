# Git 历史视图：分叉图谱 + 提交详情 + 逐文件 diff

## 目标
在 dsh-git-bar 里补一个「Git」主对话区标签页（`conversation.view`），形态对齐小帅给的 IDE 截图：

- 左列：分叉图谱 lane（彩色点 + 连线，能看出哪笔提交落在哪条流上），右侧提交行（提交信息 / 作者 / 相对时间 / ref 徽章）。
- 右列：选中提交的详情——完整提交信息、作者、日期、变更文件列表（带 +/− 行数）。
- 点详情里的文件：显示该文件在这笔提交里的逐行 diff（红绿底）。

## 不在本次范围
- 分支级写操作（merge / rebase / cherry-pick / revert / reset / tag）。
- 多条件筛选（Branch / User / Date / Paths）。本次只做「文本或哈希」单个筛选框。
- 文件浏览器、图片 diff、AI 写提交信息、暂存/提交面板。

## 放置
主对话区标签页（`conversation.view`，order 30，排在「对话 / 轨迹」之后）。理由：截图是三栏宽布局，右侧栏放不下。
输入框上方状态条（`conversation.input.dock`）与右侧栏「工作区改动」面板（`sidebar.right.pane.tab`）保持原样不动。

## 参考实现（已 clone 到 /tmp/gitplugin-eval，仅作算法参考，不拷贝代码）
- `git-panel/src/client/git-graph.ts`（220 行）：lane 状态机模型——`lanes[]` 存「当前在等哪笔提交的 hash」、
  每条 lane 一个颜色、行内边 `{fromLane, toLane, color, kind: 'into'|'out'|'pass'}`、`compact` / `parallel` 两种收敛风格。
- `ide-git/src/client.js:8580-8630`：同样的 lane 分配（第一个父提交续在当前 lane，额外父提交开新 lane）。
- `git-panel/src/host/parser.ts`：`%H%x1f%h%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s%x1e` 记录格式与 `--decorate=full` 的 ref 分类。

## Host API 契约（新增 3 条只读路由）
沿用现有约定：`sessionId` 解析会话 cwd，`dir` 仅作 store 里已不存在的会话的兜底（绝对路径校验）；
`execFile('git', argv)` 无 shell、超时 `GIT_TIMEOUT_MS`、stdout 上限 `GIT_MAX_BUFFER`；准入走 `ctx.connection.requestRejection`。

```
GET /dsh-git-bar/log?sessionId=<id>[&dir=<abs>][&limit=<1..300>]
  → { commits: [{ hash, short, parents: [hash], author, email, when, subject,
                  refs: [{ name, kind: 'head'|'local'|'remote'|'tag' }] }],
      hasMore: boolean, truncated: boolean }
  argv: git log --all --topo-order --decorate=full -n <limit+1> --format=<记录格式>
  一页取 limit+1 条判断 hasMore，只返回 limit 条；缺省 limit 60。

GET /dsh-git-bar/commit?sessionId=<id>[&dir=<abs>]&hash=<4..40 hex>
  → { hash, short, parents: [hash], author, email, when, subject, body,
      files: [{ path, status, additions, deletions, binary }], truncated }
  files 由 --numstat 与 --name-status 对位（重命名取新路径）；body 取 %b。

GET /dsh-git-bar/commit-diff?sessionId=<id>[&dir=<abs>]&hash=<4..40 hex>&path=<相对路径>
  → { diff, truncated }
  argv: git show --format= --no-ext-diff --unified=3 <hash> -- <path>
```

参数校验（与现有路由同级）：
- `hash` 匹配 `/^[0-9a-f]{4,40}$/i`。
- `path` 必须是仓库内相对路径：不以 `/` 开头、不含 `..` 段、无控制字符、不以 `-` 开头。
- `limit` 钳制到 1..300。
- 非 Git 目录 / git 失败 → 与现有路由一致的错误响应形状。

## 验收标准（可验证）
1. `npm run check` 通过；`npm test` 全绿，新增用例覆盖：
   - 三条新路由的成功路径、参数校验拒绝（坏 hash / 越界 path / 超范围 limit）、非仓库降级；
   - lane 布局纯函数：直线历史、单次合并、两次分叉、首行为 merge 提交四种形状的期望输出。
2. 真实仓库实测：打开 Git 标签，图谱形状与 `git log --all --graph --oneline` 一致（截图比对），
   点提交看到文件列表，点文件看到逐行 diff。
3. 中英词典同时补齐（`client.js` 内 `zh` / `en` 表），无裸键外露。
4. `scripts/check-privacy.mjs` 无告警，不新增真实工作区截图。

## 阶段
1. 契约定稿（本文件）。
2. Host 侧三条路由 + host 测试（`index.js`, `test/host.test.mjs`）。
3. Client 侧 lane 算法 + 历史视图组件 + 注册（`client.js`, `test/client.test.mjs`, `test/interaction.test.mjs`）。
4. 中英 README 同步，`npm run check && npm test`，本地分阶段提交（不推送）。

## 落地结果（实测）
- Host：`index.js` 新增 `ROUTE_LOG` / `ROUTE_COMMIT` / `ROUTE_COMMIT_DIFF`，共 10 条精确路由；
  `node test/host.test.mjs` → `ALL HOST TESTS PASSED`（48 块，新增 40–48）。
- Client：`client.js` 新增 `historyStyles` / `layoutGraph` / `graphLaneCount` / `GraphCell` /
  `HistoryView`，注册座位 `conversation.view`（id `git-history`, order 20, label 走 `history.tab`）。
- `node test/client.test.mjs` → 17 块全绿（新增 14 座位形状、15 直线图、16 分叉合并图、17 首屏）；
  `node test/interaction.test.mjs` → 9 块全绿（新增 6 列表+图谱、7 提交详情、8 单文件 diff、9 过滤）。
- 端到端契约核对（临时脚本，真 git 仓库 → 真 Host handler → 真组件树，未入库）：
  6 笔提交（含 `--no-ff` 合并、重命名、二进制文件），每行边数 `1,3,3,3,2,1`、图列宽 24（=2 lane），
  合并行画出 3 条边；`/commit` 文件列表 `A:blob.bin(bin), R:renamed.txt +0/-0`；
  `/commit-diff` 真 diff 行 `+one`/`+two`；非仓库目录显示「不在 Git 仓库里」。
- `npm run check` → `隐私检查通过：30 个文件，无命中`；`npm test` 三套全绿。

## 与契约的偏差（Host 实测决定，Client 已跟随）
- `refs[].name` 是短名（`main` / `origin/main` / `v1.0.0`），不是 `--decorate=full` 全名；指向 HEAD 的
  只出一条 `kind='head'`；detached HEAD 为 `{name:'HEAD',kind:'head'}`。
- `/log`、`/commit`、`/commit-diff` 都额外返回 `dir`；`/commit-diff` 还回 `hash`、`path`。
- 非仓库目录：三条路由都 200 降级（`reason:'not-a-repository'`），不当 404——否则 git 的
  `fatal: not a git repository` 会被误报成「提交不存在」。
- `limit` 缺省/非数字 → 60，数字越界才钳到 1..300；`/commit` 文件上限 `MAX_COMMIT_FILES=500`。
- 合并提交的文件列表为空（`git diff-tree` 对 merge 默认不列文件），界面因此显示「这笔提交没有文件变更」
  ——已知限制，不在本次范围。

## 第二轮：历史页的筛选栏（当前任务）

### 目标与验收
用户只要求按**分支**和**提交人**筛选（m00511：「主要就是根据分支和提交人去筛选」），
外加已有的关键字框。所以筛选栏是：关键字输入 + 分支下拉 + 用户下拉 + 重置，不做日期 / 路径。

验收标准（可验证）：
1. `node test/host.test.mjs` 覆盖 `branch` / `author` 的成功路径与非法输入拒绝（坏 ref、超长 author、控制字符），全绿。
2. `node test/client.test.mjs`、`node test/interaction.test.mjs` 覆盖筛选栏渲染、下拉选项、选中后重新请求（URL 带对应参数），全绿。
3. 真仓库实测：选分支后列表只剩该分支提交；选提交人后只剩该作者提交；两者叠加取交集。

### `/log` 参数（Host 侧契约）
```
GET /dsh-git-bar/log?sessionId=<id>[&dir=<abs>][&limit=1..300][&branch=<ref>][&author=<text>]
```
- `branch`：1..200 字符，匹配 `/^[A-Za-z0-9._/-]+$/`、不以 `-` 开头、不含 `..`；给了就把它当 rev
  （`git log <branch> ...`，替代 `--all`）。ref 不存在时 git 非零退出 → 沿用现有失败形状，`reason: 'unknown-ref'`。
- `author`：1..200 字符、无控制字符 → `--author=<text>`（git 按正则匹配姓名/邮箱）。
- 响应原有字段不变，额外回显 `filters: { branch, author }`（未启用为 `null`），供客户端断言与 UI 回显。

## 第三轮：筛选面板搜索 + 滚动 + 全量提交人候选（当前任务）

用户（m00734）：「那个筛选，需要支持输入搜索，同时你现在的面板也需要支持滚动，因为提交人或者分支可能非常多」。

现状缺口（实测代码，不是猜测）：
1. `filterChip()` 的面板只有选项按钮，没有输入框，长列表只能靠肉眼找；
2. `.menu` 虽然 `maxHeight: 240px; overflow: auto`，但整个面板一起滚，没有搜索框可固定；
3. 提交人候选只从**已加载的提交**里累积（`log.commits` 派生），仓库历史深时，排在 100 页之后的作者根本出不来。

### 目标与验收
1. 打开分支 / 提交人面板，搜索框自动聚焦；键入子串即实时过滤（不区分大小写），无命中显示「没有匹配项」；
2. 选项区独立滚动（`maxHeight` + `overflow-y: auto`），搜索框固定在顶部不随滚动；面板高度不超过视口；
3. 提交人候选来自新路由 `/dsh-git-bar/authors`，覆盖整条历史（含尚未加载的提交），按提交数降序；
   该路由失败时回退到已加载作者，不阻塞；
4. `node test/host.test.mjs` 覆盖 `/authors`：去重计数、排序、上限截断、非仓库；
   `node test/client.test.mjs` 覆盖面板搜索过滤、滚动样式、作者回退；
   `node test/interaction.test.mjs` 覆盖「打开面板 → 输入 → 过滤后点选项 → 请求带 `branch` / `author`」；
5. README 中英 + `docs/market/index.json` + 预览图同步，`package.json` 升 `0.5.0`。

### 新路由契约（Host 侧）
```
GET /dsh-git-bar/authors?sessionId=<id>[&dir=<abs>]
→ 200 { dir, authors: [{ name, email, count }], truncated }
```
- 来源：`git log --all --format=%an%x1f%ae`（不按分支过滤，候选要覆盖整条历史）；
- 按 `name + email` 聚合计数，排序 `count` 降序、同数量按 `name` 升序；
- 上限 500 条，超出时 `truncated: true`；
- `dir` 只在 Session store 查不到时兜底，且必须是绝对路径；非仓库（有 `.git` 但 `git log` 失败）→ `{ authors: [], truncated: false }`；
- 走和其他路由相同的 `requestRejection` 准入。

## 第四轮：工作树「在此新建会话」报「该目录还不是工作区」（当前任务）

用户（m00003）：「现在我点击工作树的在此新建会话会提示该目录还不是工作区」。

### 目标与验收
1. 点击工作树行的「在此新建会话」，在该 worktree 目录里开出新会话；目录未注册成工作区时先注册再开，
   不再直接报「该目录还不是工作区」；
2. 已注册目录行为不变（`workspaces.create` 幂等，返回同一 `workspaceId`）；
3. 目录已不存在（`workspace/invalid-path`）时弹层留在原地并给出「该目录已不存在，无法新建会话」，
   不静默、不假装打开；缺 Client 服务时仍是 `unsupported`；
4. `node test/interaction.test.mjs` 覆盖三条分支：已注册目录只 `create`+`open` 一次、未注册目录现场注册后打开
   （requests 依次为 `create:/repo`、`open:ws-1`、`create:/repo-hotfix`、`open:ws-3`）、目录已删时报错且弹层不关；
5. README 中英同步这句话；`npm run check` + `npm test` 全绿。
