# 发布这个插件

## 先说结论

DSH **没有**内建的插件索引源，也没有「提交到官方商店」的入口：`pluginMarket.indexes` 默认是空数组，
随 DSH 一起发布的只有 `@deepseek-ai/*` 那些包（在插件页显示为「随 DSH 提供」）。

官方文档给的路子是反过来：**你自己发布一个索引文件，别人把它的 URL 加进去**。
索引就是一份 JSON（格式 1），放任意静态托管即可（GitHub Pages / raw / 对象存储）。

所以三种发布形态，按成本从低到高：

| 形态 | 别人怎么装 | 需要什么 |
|---|---|---|
| Git 仓库直装 | `git+https://github.com/<you>/dsh-git-bar.git#<40 位 commit>` | 一个公开 GitHub 仓库 |
| npm 包 | `dsh-git-bar@0.1.0` | npm 账号 |
| 自己的插件市场 | 插件 → 发现 → 添加索引源 → 填索引 URL | 托管一份 `index.json`（可只用 Git 源） |

三种可以叠加：先推 Git，再放一份索引，别人既可以直接装、也能在「发现」里看到。

## 已经发布的位置

| 用途 | 地址 |
|---|---|
| 源码 | https://github.com/mjnhmd/dsh-git-bar |
| 直装 spec | `git+https://github.com/mjnhmd/dsh-git-bar.git#d36a82cd20f7dc0011b0e42b9cdc15c17b9a9f0a` |
| 插件市场索引 | https://mjnhmd.github.io/dsh-git-bar/market/index.json |

「发现」里添加上面那个索引 URL 就能搜到并安装。发新版本时：改 `version` → 提交 → 推 → 用新 commit
在 `docs/market/index.json` 里**追加**一条 `versions`（别改旧的）→ 再推，Pages 自动重建。

## 1. 推到 GitHub

仓库里已经有 `package.json`（`engines.dsh: >=0.2.1-rc.2`、`dsh.bundle.patch`、`dsh.client`）、
MIT `LICENSE`、`.gitignore`。

```sh
cd default-workspace/plugins/dsh-git-bar
git init && git add -A && git commit -m "feat: git status bar plugin for DSH"
gh repo create dsh-git-bar --public --source=. --push
git rev-parse HEAD   # 记下这个 40 位 commit，索引里要用
```

别人（或另一台机器上的你）安装：

```sh
dsh plugin add "git+https://github.com/mjnhmd/dsh-git-bar.git#<40 位 commit>"
```

图形界面里则是：插件 → 安装 → spec 填上面那一串。

## 2.（可选）发到 npm

```sh
npm publish    # package.json 里已去掉 private、加了 publishConfig.access=public
```

之后 spec 就是 `dsh-git-bar@0.1.0`，索引里 `source` 写成 `{ "type": "npm" }`。

## 3. 发布索引，让别人在「发现」里看到

1. 打开 **插件** → **实验性插件** 旁的 **更多** → 打开 **自定义插件市场**；之后 **已安装** 旁边出现 **发现**。
2. 把 `docs/market-index.example.json` 里的 `PUT_40_HEX_COMMIT_SHA_HERE` 换成真实 commit
   （每发一版就加一条 `versions` 条目，别改旧的），和 `icons/` 一起放到静态托管上。
3. 别人 **发现 → 添加索引源** 填索引 URL；以后版本更新，他们那边会出现「有新版本」。

索引的硬性规则（违反任意一条，整份索引会被拒，并在「管理索引源…」里报出 JSON 路径）：

- `format` 必须是 `1`；`title` 必填，本地化对象必须含 `en`。
- 每个版本的 `version` 精确 SemVer、`publishTimestamp` 是 **Unix 秒**、`source` 必填。
- Git 源必须是 https URL + **40 位小写 hex commit**（不能写分支名），子目录再加 `path`。
- `engines.dsh` 要和包自己的 `engines.dsh` 一致，安装时还会再检查一次。
- 图标：内联 `data:` URL ≤ 32 KiB，或相对索引 URL 的路径 / 绝对 https URL。

本地校验（用 DSH 自带的校验器，和插件页读到的是同一套规则）：

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" \
  scripts/validate-index.mjs docs/market-index.example.json
```

## 版本与兼容

- `package.json` 的 `engines.dsh` 目前是 `>=0.2.1-rc.2`；DSH 升级后如需收紧/放宽，改这里 + 索引里的同名字段。
- 改了 Host 代码（`index.js`）需要在插件面板把开关关一次再打开才会重载；只改 `client.js` 刷新页面即可。
- 发版流程：改 `version` → 提交 → 打 tag（`v0.1.1`）→ 推送 → 用新 commit 更新索引 → 重新发布索引文件。
