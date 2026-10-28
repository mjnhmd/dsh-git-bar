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
