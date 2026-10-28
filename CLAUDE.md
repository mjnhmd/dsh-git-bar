# dsh-git-bar 协作约定

- 根目录 `index.js` / `client.js` 分别为 Host / Client；`test/` 放测试；`docs/` 放发布文档与预览图。
- `README.md` 为英文入口，`README.zh.md` 为中文入口，功能、安装要求和截图保持一致。
- 市场截图清单放根目录 `screenshots.json`，仅引用 `docs/` 中用假数据生成的预览图。禁止提交真实工作区、内部路径、会话或凭据截图。
- 图片源模板放 `scripts/previews/`，用 `scripts/render-previews.mjs` 生成；提交前运行 `npm run check` 和 `npm test`。
- 多步任务用 `task_plan.md`、`findings.md`、`progress.md` 记录目标、事实、验证与交接；不在公共文档中记录机器私有绝对路径。
- 只修改任务相关内容；仅暂存明确文件。验证通过后本地提交；推送、改历史或改远端必须单独获授权。
- 本任务不创建临时构建文件；如需临时产物，使用系统临时目录并在验证结束后清理。
