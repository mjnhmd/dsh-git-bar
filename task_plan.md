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
