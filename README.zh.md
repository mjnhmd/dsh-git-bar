# dsh-git-bar

[English](README.md) | 简体中文

DeepSeek Harness 的 Git 状态条插件：在会话输入框上方、工作区和模式选择器所在行，显示当前会话目录的 Git 上下文。

```text
⎇ main · acme-storefront · 3 处改动 · ↑2 ↓1 · a1b2c3d
```

![输入框上方的 Git 状态条](docs/preview.png)

> 本文所有预览图均由虚构数据渲染，不包含真实项目或会话信息。

## 功能

- **仓库与分支**：显示仓库名称、根目录与当前分支；不在分支上时显示「游离 HEAD」。
- **工作区改动**：显示改动总数，悬停查看已暂存、未暂存和未跟踪数量。
- **同步状态**：显示相对上游分支的领先 / 落后提交数。
- **提交链接**：点击短 SHA，在浏览器打开 `origin` 对应的提交，支持 GitHub、GitLab、Bitbucket；本地路径远端没有链接。
- **分支切换**：点击分支名，搜索或切换本地分支，也可从当前 HEAD 新建分支。列表包含上游、领先 / 落后状态和提交摘要。
- **逐文件 diff**：点击改动数，在右侧「工作区改动」面板中选择文件、查看统一 diff，支持未跟踪文件。
- **多工作树**：显示「链接工作树」或工作树数量；点击列出各工作树的分支与改动数，可复制路径，或在指定工作树目录新建会话。不会移动现有会话。
- **分支占用提示**：已在其他工作树检出的分支会置灰，并提示占用目录。
- **文字可复制**：拖选状态条文字不会误触弹窗。

状态条每 8 秒刷新，也会在窗口重新获得焦点或切换会话时刷新。读取状态不会修改仓库；只有你明确点击切换或新建分支时才执行相应 Git 写操作。Git 拒绝切换（例如存在冲突的本地修改）时会返回错误，不自动丢弃修改。

### 分支列表

![搜索、切换或新建本地分支](docs/preview-branches.png)

### 工作区改动

![右侧边栏中的逐文件 diff](docs/preview-changes.png)

## 安装

需要 **DSH >= 0.2.1-rc.2**，且宿主进程能访问 `git` 命令。本插件当前通过 GitHub 发布，不依赖 npm 账号。

### 桌面端

在应用自己的插件管理器中找到安装 / 添加插件入口，填入以下固定提交的安装来源：

```text
git+https://github.com/mjnhmd/dsh-git-bar.git#2d3e0408376127196a4c18e8b1e1c79389a166f5
```

也可在已安装的社区 `dshmarket` 中搜索 **dsh-git-bar** 安装。不要假定桌面应用使用 CLI 的 `web` profile；请用桌面应用自带的插件管理器。

### 普通 dsh web

```bash
dsh plugin --profile web add "git+https://github.com/mjnhmd/dsh-git-bar.git#2d3e0408376127196a4c18e8b1e1c79389a166f5"
```

自定义 profile 请将 `web` 替换为实际使用的名称。本地开发可使用：

```bash
dsh plugin --profile web add link:/absolute/path/to/dsh-git-bar
```

首次安装后需重启宿主，以加载 Host 部分；Client 部分在下次页面加载时提供。

### 自定义索引源

在 **插件 → 发现 → 添加索引源** 中添加：

<https://mjnhmd.github.io/dsh-git-bar/market/index.json>

部分宿主需先开启「自定义插件市场」。该索引由本项目自行托管，与社区市场目录独立。社区详情页：<https://awesome-dsh-plugin.com/p/mjnhmd/dsh-git-bar/>。

## 市场预览图

根目录的 [screenshots.json](screenshots.json) 按顺序声明三张预览图，路径相对于该文件。社区目录的下一次每日构建会采集已推送的清单；本地修改或仅在 README 中加图，不代表卡片立即更新。

图片由 `scripts/previews/` 中的虚构场景生成。更新时继续使用假数据，不要上传含内部路径、凭据或真实会话信息的截图。

## Host API

所有接口均通过宿主浏览器会话认证（`ctx.connection.requestRejection`），不是无认证的公开接口。目录优先取自会话存储；仅信息接口可用绝对路径 `dir` 作为未知会话的回退。

| 请求 | 行为 / 返回值 |
|---|---|
| `GET /dsh-git-bar/info?sessionId=<id>[&dir=<absolute path>]` | 返回 `{ dir, repository }`；不是 Git 仓库时 `repository` 为 `null` |
| `GET /dsh-git-bar/branches?sessionId=<id>` | 返回 `{ branches, dirty }`；分支包含 `name`、`current`、`upstream`、`ahead`、`behind`、`subject`、`checkedOutIn` |
| `GET /dsh-git-bar/worktrees?sessionId=<id>` | 返回 `{ root, worktrees }`，包含路径、分支、SHA、主 / 当前工作树标记和改动数 |
| `POST /dsh-git-bar/branches/checkout` | 请求 `{ sessionId, branch }`，成功返回 `{ branch, created: false }`；Git 拒绝时返回 409 |
| `POST /dsh-git-bar/branches/create` | 请求 `{ sessionId, name, from? }`，通过 `git check-ref-format --branch` 校验名称，成功返回 `{ branch, created: true }` |
| `GET /dsh-git-bar/changes?sessionId=<id>` | 返回 `{ files, dirty, truncated }`，文件含路径、状态、暂存标记和增删行数，最多 500 个文件 |
| `GET /dsh-git-bar/diff?sessionId=<id>&path=<repo-relative>&staged=0\|1` | 返回 `{ path, staged, diff, truncated }`，diff 最多 200,000 个字符 |

`repository` 包含 `root`、`name`、`branch`、`detached`、`sha`、`commitUrl`、`remote`、`dirty: { changed, staged, unstaged, untracked }`、`upstream`、`ahead`、`behind` 和 `worktree: { linked, mainRoot, count }`。

远端地址支持 scp、`ssh://`、`git://`、HTTP(S) 形式，提交链接会规范化为 HTTPS。所有 Git 调用使用参数数组而非 shell，单次超时 4 秒，输出缓冲区上限 256 KiB；不监听文件，也不缓存结果。列出工作树时，每个工作树会执行一次状态查询。

## 开发与验证

```bash
npm run check
npm test
```

`check` 包括 JavaScript 语法与已跟踪文本的隐私检查；测试涵盖 Host、Client 和交互。公开预览图必须继续由假数据生成。

| 路径 | 用途 |
|---|---|
| `index.js` | Host 接口和 Git 操作 |
| `client.js` | 状态条、分支 / 工作树弹窗和右侧改动面板 |
| `cordis.patch.yml` | 注册 `git-bar` 组件的 bundle patch |
| `locale/*.json` | 插件管理器中的中英文元数据 |
| `icon.svg` | 插件图标 |
| `screenshots.json` | 社区市场预览图清单 |
| `docs/preview*.png` | 假数据预览图 |
| `scripts/previews/` | 预览图场景模板 |
| `scripts/render-previews.mjs` | 预览图生成脚本 |
| `scripts/check-privacy.mjs` | 已跟踪文本隐私检查 |
| `test/*.mjs` | Host、Client 和交互测试 |

发布方式及索引校验见 [发布指南](docs/PUBLISH.zh.md)。

## 许可证

[MIT](LICENSE)
