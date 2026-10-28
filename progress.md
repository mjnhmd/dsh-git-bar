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

## 下一步
本地提交后等待用户单独授权推送；推送后等待社区目录每日构建采集，再检查市场卡片。

## 边界
用户尚未授权推送；远端仓库与市场尚未更新。无需向目录旧截图映射提交 PR。
