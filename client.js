/**
 * dsh-git-bar — Client half.
 *
 * One ambient row above the composer card (`conversation.input.dock`) showing
 * the Session's repository, branch, working-tree summary, ahead/behind counts,
 * the short commit id, and a linked-worktree marker.
 *
 * The browser module never runs git. It asks the Host half over
 * `GET /dsh-git-bar/info`, refreshes on an interval, on window focus, and on a
 * Session switch, and renders nothing where the row would not belong (no
 * Session). The request is a same-origin relative path so it works both on the
 * loopback HTTP origin and inside the desktop window, whose `dsh-app://app/`
 * requests the main process forwards to the Host with its cookie attached.
 *
 * The row is read-only: no click creates or removes anything, and every string
 * goes through the Client locale service.
 */
window.__ModuleLoader__.load({
  id: 'dsh-git-bar',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Dictionary namespace owned by this plugin. */
    const NS = 'git-bar'
    /** Host route that answers the git facts for one Session. */
    const ROUTE = '/dsh-git-bar/info'
    /** Refresh interval while the page is visible. */
    const POLL_MS = 8000
    /** Host route listing branches (and the working-tree summary). */
    const BRANCHES_ROUTE = '/dsh-git-bar/branches'
    /** Host route switching to an existing branch. */
    const CHECKOUT_ROUTE = '/dsh-git-bar/branches/checkout'
    /** Host route creating and checking out a new branch. */
    const CREATE_ROUTE = '/dsh-git-bar/branches/create'

    /** 列出本仓库所有工作树。 */
    const WORKTREES_ROUTE = '/dsh-git-bar/worktrees'
    /** Host route listing the working tree. */
    const CHANGES_ROUTE = '/dsh-git-bar/changes'
    /** Host route rendering one file's unified diff. */
    const DIFF_ROUTE = '/dsh-git-bar/diff'
    /** Host route listing the commit history of the repository. */
    const LOG_ROUTE = '/dsh-git-bar/log'
    /** Host route describing one commit and the files it changed. */
    const COMMIT_ROUTE = '/dsh-git-bar/commit'
    /** Host route rendering one file's change inside one commit. */
    const COMMIT_DIFF_ROUTE = '/dsh-git-bar/commit-diff'
    /** Host route listing every author in the history, with a commit count. */
    const AUTHORS_ROUTE = '/dsh-git-bar/authors'
    /** Conversation-view tab id owned by this plugin. */
    const HISTORY_VIEW_ID = 'git-bar-history'
    /** Commits asked for by one page, and added by every "load more". */
    const HISTORY_PAGE = 60
    /** Distance from the list bottom, in px, that triggers the next page. */
    const HISTORY_SCROLL_SLACK = 120
    /** Width of one graph lane. */
    const LANE_W = 12
    /** Height of one history row; the graph cell is drawn to the same grid. */
    const GRAPH_ROW_H = 26
    /** Lane palette; a lane keeps one colour for its whole run. */
    const LANE_COLORS = ['#4f8cff', '#e879a6', '#f0a04b', '#3fb27f', '#9d7bff', '#e05d5d', '#3aa8c1', '#b5b62b']
    /** Right-Sidebar tab kind owned by this plugin. */
    const CHANGES_KIND = 'gitBarChanges'
    /** Right-Sidebar tab type owned by this plugin. */
    const CHANGES_ID = 'dsh-git-bar/changes'
    /** Address prefix of a working-tree review. */
    const CHANGES_ADDRESS = 'dsh-git-bar://changes/'

    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      'menu.search': '搜索分支',
      'menu.current': '当前',
      'menu.create': '创建并检出新分支…',
      'menu.createHint': '新分支名',
      'menu.createAction': '创建并检出',
      'menu.cancel': '取消',
      'menu.empty': '没有匹配的分支',
      'menu.dirty': '未提交：{count} 个文件',
      'menu.clean': '工作区干净',
      'menu.loading': '正在读取分支…',
      'menu.switching': '正在切换…',
      'menu.failed': '切换失败',
      'menu.open': '切换分支',
      'changes.open': '在右侧栏查看改动',
      'changes.title': '工作区改动',
      'changes.empty': '工作区没有改动',
      'changes.loading': '正在读取改动…',
      'changes.failed': '读取改动失败',
      'changes.pick': '选择一个文件查看改动',
      'changes.refresh': '刷新',
      'changes.staged': '已暂存',
      'changes.unstaged': '未暂存',
      'changes.truncated': '改动过大，仅显示前一部分',
      'changes.count': '个文件',
      'label.detached': '游离 HEAD',
      'label.changed': '处改动',
      'label.clean': '工作区干净',
      'label.notRepository': '不是 git 仓库',
      'label.unavailable': 'git 状态不可用',
      'label.worktree': '链接工作树',
      'label.ahead': '待推送',
      'label.behind': '待拉取',
      'worktree.open': '查看工作树',
      'worktree.create': '在此新建会话',
      'worktree.copy': '复制路径',
      'worktree.copied': '已复制',
      'worktree.current': '当前',
      'worktree.main': '主',
      'worktree.invalidPath': '该目录已不存在，无法新建会话',
      'worktree.unsupported': '这台机器无法新建会话',
      'worktree.loading': '正在读取工作树…',
      'worktree.failed': '读取工作树失败',
      'worktree.clean': '干净',
      'worktree.dirty': '{count} 处改动',
      'worktree.count': '{count} 个工作树',
      'menu.occupied': '已在 {name} 中使用',
      'history.title': 'Git',
      'history.tab': 'Git 历史',
      'history.count': '{count} 笔提交',
      'history.filter': '搜索提交信息或哈希',
      'history.branch': '分支',
      'history.author': '提交人',
      'history.allBranches': '全部分支',
      'history.allAuthors': '全部提交人',
      'history.reset': '重置筛选',
      'history.filterBranch': '按分支筛选',
      'history.filterAuthor': '按提交人筛选',
      'history.searchBranch': '搜索分支…',
      'history.searchAuthor': '搜索提交人…',
      'history.noOption': '没有匹配项',
      'history.refresh': '刷新',
      'history.loading': '正在读取提交历史…',
      'history.failed': '读取提交历史失败',
      'history.empty': '这个仓库还没有提交',
      'history.notRepository': '这个目录不在 Git 仓库里',
      'history.nomatch': '没有匹配的提交',
      'history.more': '加载更多提交',
      'history.pick': '选一笔提交查看详情',
      'history.files': '变更文件',
      'history.noFiles': '这笔提交没有文件变更',
      'history.diffPick': '选一个文件看它在这笔提交里的改动',
      'history.binary': '二进制',
      'history.merge': '合并',
      'history.truncated': '内容过大，仅显示前一部分',
      'history.today': '今天',
      'history.yesterday': '昨天',
    }

    /** English dictionary, checked complete against the zh key set. */
    const en = {
      'menu.search': 'Search branches',
      'menu.current': 'current',
      'menu.create': 'Create and check out a new branch…',
      'menu.createHint': 'New branch name',
      'menu.createAction': 'Create and check out',
      'menu.cancel': 'Cancel',
      'menu.empty': 'No branch matches',
      'menu.dirty': 'Uncommitted: {count} files',
      'menu.clean': 'Working tree clean',
      'menu.loading': 'Reading branches…',
      'menu.switching': 'Switching…',
      'menu.failed': 'Switch failed',
      'menu.open': 'Switch branch',
      'changes.open': 'Review changes in the sidebar',
      'changes.title': 'Working tree',
      'changes.empty': 'No changes in the working tree',
      'changes.loading': 'Reading changes…',
      'changes.failed': 'Could not read changes',
      'changes.pick': 'Pick a file to see its diff',
      'changes.refresh': 'Refresh',
      'changes.staged': 'staged',
      'changes.unstaged': 'unstaged',
      'changes.truncated': 'Diff too large; showing the first part',
      'changes.count': 'files',
      'label.detached': 'detached HEAD',
      'label.changed': 'changed',
      'label.clean': 'clean',
      'label.notRepository': 'not a git repository',
      'label.unavailable': 'git status unavailable',
      'label.worktree': 'linked worktree',
      'label.ahead': 'ahead',
      'label.behind': 'behind',
      'worktree.open': 'Worktrees',
      'worktree.create': 'New session here',
      'worktree.copy': 'Copy path',
      'worktree.copied': 'Copied',
      'worktree.current': 'current',
      'worktree.main': 'main',
      'worktree.invalidPath': 'that directory is gone',
      'worktree.unsupported': 'cannot create a session here',
      'worktree.loading': 'Reading worktrees…',
      'worktree.failed': 'Could not read worktrees',
      'worktree.clean': 'clean',
      'worktree.dirty': '{count} changed',
      'worktree.count': '{count} worktrees',
      'menu.occupied': 'checked out in {name}',
      'history.title': 'Git',
      'history.tab': 'Git history',
      'history.count': '{count} commits',
      'history.filter': 'Filter by message or hash',
      'history.branch': 'Branch',
      'history.author': 'Author',
      'history.allBranches': 'All branches',
      'history.allAuthors': 'All authors',
      'history.reset': 'Clear filters',
      'history.filterBranch': 'Filter by branch',
      'history.filterAuthor': 'Filter by author',
      'history.searchBranch': 'Search branches…',
      'history.searchAuthor': 'Search authors…',
      'history.noOption': 'No match',
      'history.refresh': 'Refresh',
      'history.loading': 'Reading history…',
      'history.failed': 'Could not read history',
      'history.empty': 'This repository has no commits yet',
      'history.notRepository': 'This directory is not inside a Git repository',
      'history.nomatch': 'No commit matches',
      'history.more': 'Load more commits',
      'history.pick': 'Pick a commit to see its detail',
      'history.files': 'Changed files',
      'history.noFiles': 'This commit changes no file',
      'history.diffPick': 'Pick a file to see its change in this commit',
      'history.binary': 'binary',
      'history.merge': 'merge',
      'history.truncated': 'Content too large; showing the first part',
      'history.today': 'Today',
      'history.yesterday': 'Yesterday',
    }

    const styles = {
      // 外层：与卡片同宽同 x 位置的锚点。首屏（hero）靠锚定模式压成 0 高度，
      // 这样它不占竖直空间，不会把“工作区 / 模式”那一行往上顶。
      barWrap: {
        width:
          'min(calc(100% - 2 * var(--dsh-composer-side-clearance, 16px)), var(--dsh-composer-card-max-width, 952px))',
        flex: '0 0 auto',
        margin: '0 auto',
        minWidth: 0,
      },
      barWrapAnchored: {
        width:
          'min(calc(100% - 2 * var(--dsh-composer-side-clearance, 16px)), var(--dsh-composer-card-max-width, 952px))',
        flex: '0 0 auto',
        margin: '0 auto',
        minWidth: 0,
        position: 'relative',
        height: 0,
        minHeight: 0,
        overflow: 'visible',
      },
      bar: {
        // 与输入框卡片同宽同位置：卡片是 margin:0 auto + 这两个变量算出来的居中盒，
        // 所以这一行复用同一套公式，再把内容推到右端，右边缘才会和卡片重合。
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
        gap: '5px',
        // 宽度交给外层锚点：那一层已经量到卡片的实际宽度。
        width: '100%',
        // 卡片 = 正文列 + 32px（左右各 16），所以内缩 16px 正好和对话正文的右边界对齐。
        // 显式 border-box：内层是 width:100%，靠它把内缩算在宽度里面。
        boxSizing: 'border-box',
        paddingRight: '16px',
        minWidth: 0,
        flex: '0 0 auto',
        minHeight: '16px',
        margin: 0,
        fontSize: '11.5px',
        lineHeight: '16px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
        // 这一行只是展示，文字要能被选中、复制。
        userSelect: 'text',
        WebkitUserSelect: 'text',
      },
      branch: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        minWidth: 0,
        color: 'var(--dsw-alias-label-secondary, #6b7280)',
        fontWeight: 500,
      },
      branchText: {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: '260px',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
        fontSize: '11px',
      },
      repo: {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: '220px',
        color: 'var(--dsw-alias-label-secondary, #6b7280)',
      },
      separator: {
        color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
        opacity: 0.45,
      },
      muted: {
        color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
      },
      badge: {
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0 4px',
        borderRadius: '4px',
        background: 'var(--dsw-alias-bg-layer-2, rgba(17, 24, 39, 0.05))',
        color: 'var(--dsw-alias-label-secondary, #6b7280)',
        fontSize: '10.5px',
        letterSpacing: '0.02em',
      },
      dirtyBadge: {
        display: 'inline-flex',
        alignItems: 'center',
        color: 'var(--dsw-alias-state-warn-label, #b45309)',
      },
      icon: {
        flex: 'none',
        display: 'block',
      },
      /** 可点击的元信息片段：看起来与普通文字一致，只是能点。 */
      trigger: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        minWidth: 0,
        padding: 0,
        margin: 0,
        border: 'none',
        background: 'none',
        font: 'inherit',
        color: 'inherit',
        lineHeight: 'inherit',
        cursor: 'pointer',
      },
      menu: {
        position: 'fixed',
        zIndex: 2147483000,
        width: '312px',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        borderRadius: '10px',
        border: '1px solid var(--dsw-alias-border-l1, rgba(17, 24, 39, 0.12))',
        background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
        boxShadow: '0 12px 32px rgba(17, 24, 39, 0.16)',
        color: 'var(--dsw-alias-label-secondary, #6b7280)',
        fontSize: '12.5px',
        lineHeight: '18px',
        userSelect: 'none',
      },
      menuSearch: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 10px',
        borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(17, 24, 39, 0.08))',
      },
      menuInput: {
        flex: '1 1 auto',
        minWidth: 0,
        border: 'none',
        outline: 'none',
        background: 'transparent',
        font: 'inherit',
        color: 'var(--dsw-alias-label-primary, #111827)',
      },
      menuList: {
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        maxHeight: '248px',
        padding: '4px',
      },
      menuItem: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: '100%',
        padding: '6px 8px',
        border: 'none',
        background: 'none',
        font: 'inherit',
        color: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        borderRadius: '6px',
      },
      menuItemActive: {
        background: 'var(--dsw-alias-bg-layer-2, rgba(17, 24, 39, 0.06))',
      },
      menuItemDisabled: {
        opacity: 0.45,
        cursor: 'not-allowed',
      },
      worktreeAction: {
        font: 'inherit',
        fontSize: '11px',
        lineHeight: '18px',
        padding: '0 8px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flex: '0 0 auto',
      },
      menuName: {
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-primary, #111827)',
      },
      menuNote: {
        flex: 'none',
        marginLeft: 'auto',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
        whiteSpace: 'nowrap',
      },
      menuFooter: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: '4px',
        borderTop: '1px solid var(--dsw-alias-border-l1, rgba(17, 24, 39, 0.08))',
      },
      menuHint: {
        padding: '8px 10px',
        color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
      },
      menuError: {
        padding: '4px 10px 8px',
        color: 'var(--dsw-alias-state-error-primary, #b91c1c)',
        fontSize: '11.5px',
        whiteSpace: 'pre-wrap',
      },
      pane: {
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        height: '100%',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary, #6b7280)',
      },
      paneHead: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 10px',
        borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(17, 24, 39, 0.08))',
      },
      paneTitle: {
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: 'var(--dsw-alias-label-primary, #111827)',
      },
      paneCount: {
        fontSize: '11.5px',
        color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
      },
      paneAction: {
        marginLeft: 'auto',
        flex: 'none',
        border: 'none',
        background: 'none',
        font: 'inherit',
        color: 'var(--dsw-alias-label-secondary, #6b7280)',
        cursor: 'pointer',
        padding: '2px 4px',
        borderRadius: '4px',
      },
      paneList: {
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        maxHeight: '40%',
        padding: '4px',
        borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(17, 24, 39, 0.08))',
      },
      paneFile: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: '100%',
        padding: '4px 6px',
        border: 'none',
        background: 'none',
        font: 'inherit',
        color: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        borderRadius: '4px',
      },
      paneFileActive: {
        background: 'var(--dsw-alias-bg-layer-2, rgba(17, 24, 39, 0.06))',
      },
      panePath: {
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        direction: 'rtl',
        textAlign: 'left',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
        fontSize: '11.5px',
        color: 'var(--dsw-alias-label-primary, #111827)',
      },
      paneStat: {
        marginLeft: 'auto',
        flex: 'none',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
      },
      paneDiff: {
        flex: '1 1 auto',
        minHeight: 0,
        overflow: 'auto',
        margin: 0,
        padding: '8px 10px',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
        fontSize: '11.5px',
        lineHeight: '17px',
        whiteSpace: 'pre',
        color: 'var(--dsw-alias-label-primary, #111827)',
      },
      paneHint: {
        padding: '10px',
        color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
      },
      menuRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 8px',
      },
    }

    /** Git-branch glyph drawn with the current text color. */
    function BranchIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 12,
          height: 12,
          fill: 'none',
          'aria-hidden': true,
          style: styles.icon,
        },
        h(
          'g',
          { stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' },
          h('circle', { cx: 4, cy: 3.5, r: 1.6 }),
          h('circle', { cx: 4, cy: 12.5, r: 1.6 }),
          h('circle', { cx: 12, cy: 3.5, r: 1.6 }),
          h('path', { d: 'M4 5.1v5.8' }),
          h('path', { d: 'M12 5.1v1.4a3 3 0 0 1-3 3H4' }),
        ),
      )
    }

    /**
     * Translator used only when the locale service is unavailable.
     * Page language decides the dictionary so a Chinese UI never shows English.
     * @param key - dictionary key.
     * @returns localized label.
     */
    function fallbackT(key) {
      let lang = ''
      try {
        lang = document.documentElement.lang || navigator.language || ''
      } catch {
        lang = ''
      }
      const dict = /^zh/i.test(lang) ? zh : en
      return dict[key] ?? en[key] ?? key
    }

    /** Last path segment of an absolute path, for the not-a-repository row. */
    function leafName(path) {
      if (typeof path !== 'string' || path === '') return ''
      const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
      const index = trimmed.lastIndexOf('/')
      return index === -1 ? trimmed : trimmed.slice(index + 1)
    }

    /** Wrap a row's children into the ambient container. */
    function Row(children, style, nodeRef, barStyle) {
      return h(
        'div',
        { style: style ?? styles.barWrap, 'data-dsh-git-bar': '' },
        h(
          'div',
          {
            style: barStyle ?? styles.bar,
            role: 'status',
            'aria-live': 'polite',
            ref: nodeRef,
          },
          children,
        ),
      )
    }

    /** Interleave segments with a middle-dot separator. */
    function join(segments) {
      const children = []
      segments.forEach((node, index) => {
        if (index > 0) {
          children.push(
            h('span', { key: `separator-${index}`, style: styles.separator }, '·'),
          )
        }
        children.push(node)
      })
      return children
    }

    /** Filter branches by a case-insensitive substring of the name. */
    function filterBranches(branches, query) {
      const needle = query.trim().toLowerCase()
      if (needle === '') return branches
      return branches.filter((branch) => String(branch.name).toLowerCase().includes(needle))
    }

    /**
     * The branch popover: filter, switch, create.
     *
     * Positioned `fixed` from the trigger's rectangle so the composer's own
     * clipping cannot hide it. Every pointer action goes through the owning
     * component's actions, so this function stays a pure view.
     * @param props - menu state, translator, and actions.
     */
    /**
     * True while a text selection exists.
     *
     * 这一行的文字是可以选中复制的，而拖选结束时浏览器也会派发 click；
     * 没有这个守卫，选一段文字就会顺手弹出菜单或跳走。
     */
    function selectionActive() {
      try {
        const selection = window.getSelection()
        return selection !== null && selection !== undefined && String(selection).trim() !== ''
      } catch {
        return false
      }
    }

    /**
     * Open a URL the way the chat view does: a new tab, never this window.
     * @param url - absolute http(s) URL.
     */
    function openExternal(url) {
      try {
        window.open(url, '_blank', 'noopener,noreferrer')
      } catch (error) {
        console.warn('[dsh-git-bar] 无法打开链接:', String(error?.message ?? error))
      }
    }

    function BranchMenu(props) {
      const { data, t, actions } = props
      const nodeRef = React.useRef(null)
      const inputRef = React.useRef(null)
      const [anchor, setAnchor] = React.useState(data.anchor)

      // 窗口尺寸变化后重新贴回触发点，避免气泡飘到别处。
      React.useEffect(() => {
        const measure = () => {
          const trigger = data.trigger
          if (trigger === null || trigger === undefined) return
          if (typeof trigger.getBoundingClientRect !== 'function') return
          const rect = trigger.getBoundingClientRect()
          setAnchor({
            bottom: Math.round(window.innerHeight - rect.top + 6),
            right: Math.round(Math.max(window.innerWidth - rect.right, 8)),
          })
        }
        measure()
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
      }, [data.trigger])

      React.useEffect(() => {
        const input = inputRef.current
        if (input !== null && input !== undefined && typeof input.focus === 'function') input.focus()
      }, [data.mode])

      React.useEffect(() => {
        const onPointerDown = (event) => {
          const node = nodeRef.current
          if (node !== null && node !== undefined && node.contains(event.target)) return
          const trigger = data.trigger
          if (trigger !== null && trigger !== undefined && trigger.contains?.(event.target)) return
          actions.close()
        }
        document.addEventListener('mousedown', onPointerDown, true)
        return () => document.removeEventListener('mousedown', onPointerDown, true)
      }, [data.trigger, actions])

      const matches = filterBranches(data.branches, data.query)
      const index = matches.length === 0 ? 0 : Math.min(data.index, matches.length - 1)

      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          actions.close()
          return
        }
        if (data.mode === 'create') {
          if (event.key === 'Enter') {
            event.preventDefault()
            actions.create()
          }
          return
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          actions.move(index + 1)
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          actions.move(index - 1)
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          const branch = matches[index]
          const occupied = typeof branch?.checkedOutIn === 'string' && branch.checkedOutIn !== '' && branch.current !== true
          if (branch !== undefined && !occupied) {
            if (branch.current === true) actions.close()
            else actions.pick(branch.name)
          }
        }
      }

      const rows = matches.map((branch, position) => {
        const isCurrent = branch.current === true
        // 一个分支同一时刻只能被一个工作树 checkout：这里提前标灰，
        // 免得用户点下去只等到一句笼统的“切换失败”。
        const occupied =
          !isCurrent && typeof branch.checkedOutIn === 'string' && branch.checkedOutIn !== ''
            ? branch.checkedOutIn
            : null
        const style =
          occupied !== null
            ? { ...styles.menuItem, ...styles.menuItemDisabled }
            : position === index
              ? { ...styles.menuItem, ...styles.menuItemActive }
              : styles.menuItem
        const note = isCurrent
          ? h(
              'span',
              { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #9ca3af)' } },
              data.dirtyCount > 0 ? t('menu.dirty', { count: data.dirtyCount }) : t('menu.clean'),
            )
          : occupied !== null
            ? h(
                'span',
                { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #9ca3af)' } },
                t('menu.occupied', { name: leafName(occupied) }),
              )
            : null
        return h(
          'button',
          {
            key: branch.name,
            type: 'button',
            'data-branch': branch.name,
            'data-branch-occupied': occupied === null ? undefined : leafName(occupied),
            style,
            disabled: occupied !== null,
            title: occupied === null ? branch.name : t('menu.occupied', { name: leafName(occupied) }),
            onMouseEnter: () => {
              if (occupied === null) actions.move(position)
            },
            onClick: () => {
              if (occupied !== null) return
              if (isCurrent) actions.close()
              else actions.pick(branch.name)
            },
          },
          h(BranchIcon),
          h(
            'span',
            { style: { display: 'flex', flexDirection: 'column', minWidth: 0, textAlign: 'left' } },
            h('span', { style: styles.menuName }, branch.name),
            note,
          ),
          isCurrent ? h('span', { style: styles.menuNote }, '\u2713') : null,
        )
      })

      const search = h(
        'div',
        { style: styles.menuSearch },
        h(BranchIcon),
        h('input', {
          key: 'input',
          ref: inputRef,
          style: styles.menuInput,
          type: 'text',
          spellCheck: false,
          autoComplete: 'off',
          placeholder: data.mode === 'create' ? t('menu.createHint') : t('menu.search'),
          value: data.mode === 'create' ? data.draft : data.query,
          onChange: (event) => {
            const value = event.target.value
            if (data.mode === 'create') actions.draft(value)
            else actions.query(value)
          },
          onKeyDown,
          'data-git-bar-search': '',
        }),
      )

      const list =
        data.phase === 'loading'
          ? h('div', { style: styles.menuHint }, t('menu.loading'))
          : data.phase === 'error'
            ? h('div', { style: styles.menuError }, data.error === '' ? t('label.unavailable') : data.error)
            : matches.length === 0
              ? h('div', { style: styles.menuHint }, t('menu.empty'))
              : h('div', { style: styles.menuList, role: 'listbox' }, rows)

      const footer =
        data.mode === 'create'
          ? h(
              'div',
              { style: styles.menuFooter },
              h(
                'div',
                { style: styles.menuRow },
                h(
                  'button',
                  {
                    type: 'button',
                    style: { ...styles.menuItem, ...styles.menuItemActive, width: 'auto' },
                    disabled: data.busy || data.draft.trim() === '',
                    onClick: () => actions.create(),
                    'data-git-bar-create': '',
                  },
                  data.busy ? t('menu.switching') : t('menu.createAction'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    style: { ...styles.menuItem, width: 'auto' },
                    onClick: () => actions.mode('list'),
                  },
                  t('menu.cancel'),
                ),
              ),
            )
          : h(
              'div',
              { style: styles.menuFooter },
              h(
                'button',
                {
                  type: 'button',
                  style: styles.menuItem,
                  onClick: () => actions.mode('create'),
                  'data-git-bar-new': '',
                },
                h('span', { style: { ...styles.menuName, fontFamily: 'inherit' } }, '+ ' + t('menu.create')),
              ),
            )

      return h(
        'div',
        {
          ref: nodeRef,
          style: {
            ...styles.menu,
            bottom: `${anchor.bottom}px`,
            right: `${anchor.right}px`,
          },
          role: 'dialog',
          'aria-label': t('menu.open'),
          'data-dsh-git-bar-menu': '',
        },
        search,
        list,
        data.error !== '' && data.phase !== 'error' ? h('div', { style: styles.menuError }, data.error) : null,
        footer,
      )
    }

    /**
     * 工作树列表：本仓库的每个工作树一行，当前这个打勾。
     *
     * 一个工作树就是一个目录，所以这里的动作是「在那个目录里开新会话」，
     * 而不是把当前会话搬过去 —— 会话的 cwd 建好就固定了。
     *
     * @param props - 弹层数据、翻译器，以及行动作。
     */
    function WorktreeMenu(props) {
      const { data, t, actions } = props
      const nodeRef = React.useRef(null)
      const [anchor, setAnchor] = React.useState(data.anchor)
      const [copied, setCopied] = React.useState('')

      React.useEffect(() => {
        const measure = () => {
          const trigger = data.trigger
          if (trigger === null || trigger === undefined) return
          if (typeof trigger.getBoundingClientRect !== 'function') return
          const rect = trigger.getBoundingClientRect()
          setAnchor({
            bottom: Math.round(window.innerHeight - rect.top + 6),
            right: Math.round(Math.max(window.innerWidth - rect.right, 8)),
          })
        }
        measure()
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
      }, [data.trigger])

      React.useEffect(() => {
        const onPointerDown = (event) => {
          const node = nodeRef.current
          if (node !== null && node !== undefined && node.contains(event.target)) return
          const trigger = data.trigger
          if (trigger !== null && trigger !== undefined && trigger.contains?.(event.target)) return
          actions.close()
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') actions.close()
        }
        document.addEventListener('mousedown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('mousedown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [data.trigger, actions])

      const rows = (data.worktrees ?? []).map((entry) => {
        const marks = []
        if (entry.main === true) marks.push(t('worktree.main'))
        if (entry.current === true) marks.push(t('worktree.current'))
        const dirty =
          entry.dirty === null || entry.dirty === undefined
            ? ''
            : entry.dirty.changed > 0
              ? t('worktree.dirty', { count: entry.dirty.changed })
              : t('worktree.clean')
        const meta = [
          entry.branch === null || entry.branch === undefined ? t('label.detached') : entry.branch,
          dirty,
        ]
          .filter((part) => part !== '')
          .join(' · ')
        return h(
          'div',
          {
            key: entry.path,
            style: { ...styles.menuItem, cursor: 'default' },
            title: entry.path,
            'data-worktree': entry.path,
          },
          h(
            'span',
            { style: { display: 'flex', flexDirection: 'column', minWidth: 0, textAlign: 'left', flex: '1 1 auto' } },
            h('span', { style: styles.menuName }, entry.name + (marks.length === 0 ? '' : ` · ${marks.join(' / ')}`)),
            h('span', { style: { ...styles.menuNote, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, meta),
          ),
          entry.current === true || entry.prunable === true
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  style: styles.worktreeAction,
                  'data-worktree-open': entry.path,
                  onClick: () => actions.open(entry.path),
                },
                t('worktree.create'),
              ),
          h(
            'button',
            {
              type: 'button',
              style: styles.worktreeAction,
              'data-worktree-copy': entry.path,
              onClick: async () => {
                const ok = await actions.copy(entry.path)
                setCopied(ok === true ? entry.path : '')
              },
            },
            copied === entry.path ? t('worktree.copied') : t('worktree.copy'),
          ),
        )
      })

      const body =
        data.phase === 'loading'
          ? h('div', { style: styles.menuHint }, t('worktree.loading'))
          : data.phase === 'error'
            ? h('div', { style: styles.menuError }, data.error === '' ? t('worktree.failed') : data.error)
            : rows.length === 0
              ? h('div', { style: styles.menuHint }, t('label.unavailable'))
              : h('div', { style: styles.menuList }, rows)

      return h(
        'div',
        {
          ref: nodeRef,
          style: { ...styles.menu, bottom: `${anchor.bottom}px`, right: `${anchor.right}px` },
          role: 'dialog',
          'aria-label': t('worktree.open'),
          'data-dsh-git-bar-worktrees': '',
        },
        h(
          'div',
          { style: styles.menuSearch },
          h('span', { style: { ...styles.menuName, fontFamily: 'inherit' } }, t('worktree.open')),
        ),
        body,
        data.error !== '' && data.phase !== 'error' ? h('div', { style: styles.menuError }, data.error) : null,
      )
    }

    /**
     * The composer dock row.
     * @param props - `sessionId` from the slot, the directory reader, and the translator.
     */
    function GitBar(props) {
      const sessionId = props.sessionId
      const readCwd = typeof props.readCwd === 'function' ? props.readCwd : () => undefined
      const t = typeof props.t === 'function' ? props.t : fallbackT
      const [view, setView] = React.useState({ phase: 'loading' })
      const [menu, setMenu] = React.useState(null)
      const [worktreeMenu, setWorktreeMenu] = React.useState(null)
      const [place, setPlace] = React.useState({ mode: 'flow', bottom: 0, width: 0, maxWidth: 0, inset: 0 })
      const reloadRef = React.useRef(null)
      const rowRef = React.useRef(null)

      // 把这一行浮到卡片上方“工作区 / 模式”那一行的同一基线：0 高度锚点不参与布局，
      // 所以首屏那两行不会被顶上去；行内容仍与卡片右边缘对齐。
      const layoutEffect = React.useLayoutEffect ?? React.useEffect
      layoutEffect(() => {
        const bar = rowRef.current
        const wrap = bar?.parentElement
        if (bar === undefined || bar === null) return
        if (wrap === undefined || wrap === null) return
        // 槽位外面还套着 `display: contents` 的包裹层，跳过它才是 composer 的纵向栈。
        let stack = wrap.parentElement
        while (stack !== null && typeof window !== 'undefined' && window.getComputedStyle(stack).display === 'contents') {
          stack = stack.parentElement
        }
        if (stack === null) return

        const measure = () => {
          const anchor = wrap.getBoundingClientRect()
          // 卡片宽度直接量：首屏左右各留 16px、会话内铺满整宽，复算 CSS 变量对不上。
          const editable = stack.querySelector('[contenteditable="true"]')
          let card = editable
          while (card !== null && card !== stack) {
            const radius = Number.parseFloat(window.getComputedStyle(card).borderTopLeftRadius)
            if (radius > 6) break
            card = card.parentElement
          }
          const cardRect = card === null || card === stack ? undefined : card.getBoundingClientRect()
          const width = cardRect === undefined ? 0 : Math.round(cardRect.width)

          // 首屏把“工作区 / 模式”那一行和卡片分开摆；会话内那一行在卡片里，找不到就退回常规流。
          const selector = stack.querySelector('[class*="WorkspaceRow"]')
          const selectorRect = selector === null ? undefined : selector.getBoundingClientRect()
          // 同一行左侧被“工作区 / 模式”占掉多少：状态条只能用到剩下的宽度，
          // 否则窄窗口下会压到智能体名字上。
          let leftUsed = 0
          if (selectorRect !== undefined) {
            for (const child of selector.children) {
              const rect = child.getBoundingClientRect()
              if (rect.width > 1) leftUsed = Math.max(leftUsed, rect.right)
            }
          }
          const available =
            cardRect === undefined || leftUsed === 0
              ? width
              : Math.round(cardRect.right - leftUsed - 12)

          const next =
            selectorRect === undefined || selectorRect.height <= 1 || selectorRect.bottom > anchor.top + 1
              ? { mode: 'flow', bottom: 0, width, maxWidth: width }
              : {
                  mode: 'anchored',
                  bottom: Math.round(anchor.top - (selectorRect.top + selectorRect.height / 2) - 8),
                  width,
                  maxWidth: Math.max(available, 0),
                }
          setPlace((current) =>
            current.mode === next.mode &&
            Math.abs(current.bottom - next.bottom) < 1 &&
            current.width === next.width &&
            current.maxWidth === next.maxWidth
              ? current
              : next,
          )
        }

        measure()
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined
        if (observer !== undefined) observer.observe(stack)
        window.addEventListener('resize', measure)
        return () => {
          if (observer !== undefined) observer.disconnect()
          window.removeEventListener('resize', measure)
        }
      }, [sessionId, view.phase, place.mode])

      const patchMenu = (patch) =>
        setMenu((current) => (current === null ? null : { ...current, ...patch }))

      const loadBranches = async () => {
        const query = new URLSearchParams({ sessionId })
        const cwd = readCwd()
        if (typeof cwd === 'string' && cwd !== '') query.set('dir', cwd)
        try {
          const response = await fetch(`${BRANCHES_ROUTE}?${query.toString()}`, {
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const body = await response.json()
          patchMenu({
            phase: 'ready',
            branches: Array.isArray(body.branches) ? body.branches : [],
            dirtyCount: typeof body.dirty?.changed === 'number' ? body.dirty.changed : 0,
          })
        } catch (error) {
          patchMenu({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      }

      const openMenu = (event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        setMenu({
          anchor: {
            bottom: Math.round(window.innerHeight - rect.top + 6),
            right: Math.round(Math.max(window.innerWidth - rect.right, 8)),
          },
          trigger: event.currentTarget,
          phase: 'loading',
          branches: [],
          dirtyCount: 0,
          query: '',
          index: 0,
          mode: 'list',
          draft: '',
          busy: false,
          error: '',
        })
        loadBranches()
      }

      const submitBranch = async (route, payload) => {
        patchMenu({ busy: true, error: '' })
        const cwd = readCwd()
        try {
          const response = await fetch(route, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              sessionId,
              ...(typeof cwd === 'string' && cwd !== '' ? { dir: cwd } : {}),
              ...payload,
            }),
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok) {
            patchMenu({ busy: false, error: body.message ?? body.error ?? `HTTP ${response.status}` })
            return
          }
          setMenu(null)
          if (reloadRef.current !== null) reloadRef.current()
        } catch (error) {
          patchMenu({ busy: false, error: error instanceof Error ? error.message : String(error) })
        }
      }

      const lastIndex = Math.max((menu?.branches?.length ?? 1) - 1, 0)
      const menuActions = {
        close: () => setMenu(null),
        move: (index) => patchMenu({ index: Math.min(Math.max(index, 0), lastIndex) }),
        query: (query) => patchMenu({ query, index: 0 }),
        draft: (draft) => patchMenu({ draft }),
        mode: (mode) => patchMenu({ mode, draft: '', error: '' }),
        pick: (branch) => submitBranch(CHECKOUT_ROUTE, { branch }),
        create: () => submitBranch(CREATE_ROUTE, { name: String(menu?.draft ?? '').trim() }),
      }

      const patchWorktreeMenu = (patch) =>
        setWorktreeMenu((current) => (current === null ? current : { ...current, ...patch }))

      const loadWorktrees = async () => {
        const query = new URLSearchParams({ sessionId })
        const cwd = readCwd()
        if (typeof cwd === 'string' && cwd !== '') query.set('dir', cwd)
        try {
          const response = await fetch(`${WORKTREES_ROUTE}?${query.toString()}`, {
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const body = await response.json()
          patchWorktreeMenu({
            phase: 'ready',
            worktrees: Array.isArray(body.worktrees) ? body.worktrees : [],
            error: body.reason === 'not-a-repository' ? t('label.unavailable') : '',
          })
        } catch (error) {
          patchWorktreeMenu({
            phase: 'error',
            worktrees: [],
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      const openWorktreeMenu = (event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        setWorktreeMenu({
          anchor: {
            bottom: Math.round(window.innerHeight - rect.top + 6),
            right: Math.round(Math.max(window.innerWidth - rect.right, 8)),
          },
          trigger: event.currentTarget,
          phase: 'loading',
          worktrees: [],
          error: '',
        })
        loadWorktrees()
      }

      const worktreeMenuActions = {
        close: () => setWorktreeMenu(null),
        open: async (path) => {
          patchWorktreeMenu({ error: '' })
          const result = typeof props.openSessionIn === 'function' ? await props.openSessionIn(path) : 'unsupported'
          if (result === 'opened') {
            setWorktreeMenu(null)
            return
          }
          patchWorktreeMenu({
            error: result === 'invalid-path' ? t('worktree.invalidPath') : t('worktree.unsupported'),
          })
        },
        copy: (path) => (typeof props.copyText === 'function' ? props.copyText(path) : Promise.resolve(false)),
      }

      React.useEffect(() => {
        setMenu(null)
        setWorktreeMenu(null)
        if (typeof sessionId !== 'string' || sessionId === '') {
          setView({ phase: 'idle' })
          return undefined
        }

        let disposed = false
        const read = async () => {
          try {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          } catch {
            // A page without a visibility state still polls.
          }
          const query = new URLSearchParams({ sessionId })
          const cwd = readCwd()
          if (typeof cwd === 'string' && cwd !== '') query.set('dir', cwd)
          try {
            const response = await fetch(`${ROUTE}?${query.toString()}`, {
              headers: { accept: 'application/json' },
              credentials: 'same-origin',
              cache: 'no-store',
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const body = await response.json()
            if (!disposed) setView({ phase: 'ready', body })
          } catch (error) {
            if (!disposed) {
              const message = error instanceof Error ? error.message : String(error)
              console.warn('[dsh-git-bar] 状态不可用:', message)
              setView({ phase: 'failed', message })
            }
          }
        }

        reloadRef.current = read
        read()
        const timer = window.setInterval(read, POLL_MS)
        const onFocus = () => {
          read()
        }
        window.addEventListener('focus', onFocus)
        return () => {
          disposed = true
          reloadRef.current = null
          window.clearInterval(timer)
          window.removeEventListener('focus', onFocus)
        }
      }, [sessionId])

      const anchored = place.mode === 'anchored'
      // 锚点始终保持卡片宽度（右边缘才对得上）；可用宽度限制放在内层那一行上，
      // 用 margin-left:auto 让它往右收，而不是整体居中缩小。
      const sized = place.width > 0 ? { width: `${place.width}px`, maxWidth: '100%' } : undefined
      const clamped =
        place.maxWidth > 0 && place.maxWidth < place.width
          ? { maxWidth: `${place.maxWidth}px`, marginLeft: 'auto' }
          : undefined
      const rowStyle = { ...(anchored ? styles.barWrapAnchored : styles.barWrap), ...sized }
      const barStyle = anchored
        ? {
            ...styles.bar,
            position: 'absolute',
            right: 0,
            bottom: `${place.bottom}px`,
            margin: 0,
            maxWidth: '100%',
            ...(clamped ?? {}),
          }
        : { ...styles.bar, ...(clamped ?? {}) }

      if (view.phase !== 'ready' && view.phase !== 'failed') return null
      if (view.phase === 'failed') {
        return Row(
          [h(BranchIcon), h('span', { style: styles.muted }, t('label.unavailable'))],
          rowStyle,
          rowRef,
          barStyle,
        )
      }

      const body = view.body ?? {}
      const repository = body.repository ?? null
      if (repository === null) {
        const label = body.reason === 'not-a-repository' ? t('label.notRepository') : t('label.unavailable')
        const leaf = leafName(body.dir)
        return Row(
          [
            h(BranchIcon),
            h(
              'span',
              { key: 'status', style: styles.muted, title: body.dir ?? '' },
              leaf === '' ? label : `${label} · ${leaf}`,
            ),
          ],
          rowStyle,
          rowRef,
          barStyle,
        )
      }

      const segments = [
        h(
          'button',
          {
            key: 'branch',
            type: 'button',
            style: styles.trigger,
            title: t('menu.open'),
            'aria-haspopup': 'dialog',
            'aria-expanded': menu === null ? 'false' : 'true',
            'data-git-bar-trigger': '',
            onClick: (event) => {
              if (selectionActive()) return
              if (menu === null) openMenu(event)
              else setMenu(null)
            },
          },
          h(BranchIcon),
          h(
            'span',
            { style: { ...styles.branchText, color: 'var(--dsw-alias-label-secondary, #6b7280)', fontWeight: 500 } },
            repository.branch === null ? t('label.detached') : repository.branch,
          ),
        ),
        h('span', { key: 'repo', style: styles.repo, title: repository.root }, repository.name),
      ]

      const dirty = repository.dirty ?? { changed: 0 }
      if (dirty.changed > 0) {
        segments.push(
          h(
            'button',
            {
              key: 'dirty',
              type: 'button',
              'data-git-bar-changes': '',
              style: {
                ...styles.dirtyBadge,
                border: 'none',
                padding: 0,
                margin: 0,
                background: 'none',
                font: 'inherit',
                cursor: 'pointer',
              },
              title: t('changes.open'),
              onClick: () => {
                if (selectionActive()) return
                if (typeof props.openChanges === 'function') props.openChanges()
              },
            },
            `${dirty.changed} ${t('label.changed')}`,
          ),
        )
      } else {
        segments.push(
          h('span', { key: 'clean', style: styles.muted }, t('label.clean')),
        )
      }

      const ahead = typeof repository.ahead === 'number' ? repository.ahead : 0
      const behind = typeof repository.behind === 'number' ? repository.behind : 0
      if (ahead > 0 || behind > 0) {
        const parts = []
        if (ahead > 0) parts.push(`↑${ahead}`)
        if (behind > 0) parts.push(`↓${behind}`)
        segments.push(
          h(
            'span',
            {
              key: 'tracking',
              style: styles.muted,
              title: repository.upstream === null ? '' : repository.upstream,
            },
            parts.join(' '),
          ),
        )
      }

      const worktreeInfo = repository.worktree ?? null
      const worktreeCount = typeof worktreeInfo?.count === 'number' ? worktreeInfo.count : 1
      if (worktreeInfo !== null && (worktreeInfo.linked === true || worktreeCount > 1)) {
        segments.push(
          h(
            'button',
            {
              key: 'worktree',
              type: 'button',
              'data-git-bar-worktrees-trigger': '',
              style: {
                ...styles.badge,
                border: 'none',
                padding: 0,
                margin: 0,
                background: 'none',
                font: 'inherit',
                cursor: 'pointer',
              },
              title: t('worktree.open'),
              'aria-haspopup': 'dialog',
              'aria-expanded': worktreeMenu === null ? 'false' : 'true',
              onClick: (event) => {
                if (selectionActive()) return
                if (worktreeMenu === null) openWorktreeMenu(event)
                else setWorktreeMenu(null)
              },
            },
            worktreeInfo.linked === true ? t('label.worktree') : t('worktree.count', { count: worktreeCount }),
          ),
        )
      }

      if (typeof repository.sha === 'string' && repository.sha !== '') {
        const commitUrl = typeof repository.commitUrl === 'string' && repository.commitUrl !== '' ? repository.commitUrl : null
        segments.push(
          commitUrl === null
            ? h('span', { key: 'sha', style: styles.muted, title: repository.sha }, repository.sha)
            : h(
                'button',
                {
                  key: 'sha',
                  type: 'button',
                  'data-git-bar-commit': '',
                  style: {
                    ...styles.muted,
                    border: 'none',
                    padding: 0,
                    margin: 0,
                    background: 'none',
                    font: 'inherit',
                    cursor: 'pointer',
                  },
                  title: commitUrl,
                  onClick: () => {
                    if (selectionActive()) return
                    openExternal(commitUrl)
                  },
                  onMouseEnter: (event) => {
                    event.currentTarget.style.textDecoration = 'underline'
                  },
                  onMouseLeave: (event) => {
                    event.currentTarget.style.textDecoration = 'none'
                  },
                },
                repository.sha,
              ),
        )
      }

      const children = join(segments)
      if (menu !== null) {
        children.push(h(BranchMenu, { key: 'menu', data: menu, t, actions: menuActions }))
      }
      if (worktreeMenu !== null) {
        children.push(h(WorktreeMenu, { key: 'worktree-menu', data: worktreeMenu, t, actions: worktreeMenuActions }))
      }
      return Row(children, rowStyle, rowRef, barStyle)
    }

    /**
     * Read a working-tree address back into its parts.
     * @param address - a tab content id.
     * @returns session id and directory, or undefined for a foreign address.
     */
    function parseChangesAddress(address) {
      const text = String(address ?? '')
      if (!text.startsWith(CHANGES_ADDRESS)) return undefined
      const parts = text.slice(CHANGES_ADDRESS.length).split('/')
      if (parts.length === 0 || parts[0] === '') return undefined
      return {
        sessionId: decodeURIComponent(parts[0]),
        dir: parts.length > 1 ? decodeURIComponent(parts.slice(1).join('/')) : '',
      }
    }

    /** Colour one diff line by its leading marker. */
    function diffLineStyle(line) {
      if (line.startsWith('+++') || line.startsWith('---')) {
        return { color: 'var(--dsw-alias-label-tertiary, #9ca3af)' }
      }
      if (line.startsWith('+')) return { color: 'var(--dsw-alias-state-success-primary, #15803d)' }
      if (line.startsWith('-')) return { color: 'var(--dsw-alias-state-error-primary, #b91c1c)' }
      if (line.startsWith('@@')) return { color: 'var(--dsw-alias-label-tertiary, #9ca3af)' }
      return undefined
    }

    /**
     * The working-tree review shown in the right Sidebar: the changed files, and
     * the unified diff of the one that is picked.
     * @param props - slot props; `useTabInfo` carries the address this tab opened.
     */
    function ChangesPane(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT
      let contentId = ''
      try {
        if (typeof props.useTabInfo === 'function') contentId = props.useTabInfo().tab.contentId
      } catch {
        contentId = ''
      }
      const parsed = parseChangesAddress(contentId)
      const sessionId = parsed?.sessionId ?? (typeof props.sessionId === 'string' ? props.sessionId : '')
      const dir = parsed?.dir ?? ''

      const [state, setState] = React.useState({ phase: 'loading', files: [], truncated: false, error: '' })
      const [picked, setPicked] = React.useState({ path: '', phase: 'idle', diff: '', truncated: false })

      const queryFor = (extra) => {
        const params = new URLSearchParams({ sessionId })
        if (dir !== '') params.set('dir', dir)
        for (const key of Object.keys(extra)) params.set(key, String(extra[key]))
        return params.toString()
      }

      const load = async () => {
        setState({ phase: 'loading', files: [], truncated: false, error: '' })
        try {
          const response = await fetch(`${CHANGES_ROUTE}?${queryFor({})}`, {
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(body.message ?? body.error ?? `HTTP ${response.status}`)
          setState({
            phase: 'ready',
            files: Array.isArray(body.files) ? body.files : [],
            truncated: body.truncated === true,
            error: '',
          })
        } catch (error) {
          setState({ phase: 'failed', files: [], truncated: false, error: error instanceof Error ? error.message : String(error) })
        }
      }

      React.useEffect(() => {
        load()
      }, [sessionId, dir])

      const pick = async (file) => {
        const staged = file.staged === true
        setPicked({ path: file.path, phase: 'loading', diff: '', truncated: false })
        try {
          const response = await fetch(`${DIFF_ROUTE}?${queryFor({ path: file.path, staged: staged ? 1 : 0 })}`, {
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
          })
          const body = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(body.message ?? body.error ?? `HTTP ${response.status}`)
          setPicked({
            path: file.path,
            phase: 'ready',
            diff: String(body.diff ?? ''),
            truncated: body.truncated === true,
          })
        } catch (error) {
          setPicked({
            path: file.path,
            phase: 'failed',
            diff: error instanceof Error ? error.message : String(error),
            truncated: false,
          })
        }
      }

      const head = h(
        'div',
        { style: styles.paneHead },
        h(
          'span',
          { style: styles.paneCount },
          state.phase === 'ready' ? `${state.files.length}${state.truncated ? '+' : ''} ${t('changes.count')}` : '',
        ),
        h(
          'button',
          { type: 'button', style: styles.paneAction, onClick: () => load(), title: t('changes.refresh') },
          t('changes.refresh'),
        ),
      )

      const files =
        state.phase === 'loading'
          ? h('div', { style: styles.paneHint }, t('changes.loading'))
          : state.phase === 'failed'
            ? h('div', { style: styles.paneHint }, `${t('changes.failed')} · ${state.error}`)
            : state.files.length === 0
              ? h('div', { style: styles.paneHint }, t('changes.empty'))
              : h(
                  'div',
                  { style: styles.paneList },
                  state.files.map((file) =>
                    h(
                      'button',
                      {
                        key: `${file.path}:${file.staged === true ? 's' : 'w'}`,
                        type: 'button',
                        'data-changes-file': file.path,
                        style:
                          picked.path === file.path
                            ? { ...styles.paneFile, ...styles.paneFileActive }
                            : styles.paneFile,
                        title: `${file.path} — ${file.status}${file.staged === true ? ` (${t('changes.staged')})` : ''}`,
                        onClick: () => pick(file),
                      },
                      h('span', { style: { flex: 'none', width: '10px', color: 'var(--dsw-alias-label-tertiary, #9ca3af)' } }, file.status),
                      h('span', { style: styles.panePath }, file.path),
                      typeof file.additions === 'number' && typeof file.deletions === 'number'
                        ? h('span', { style: styles.paneStat }, `+${file.additions} −${file.deletions}`)
                        : null,
                    ),
                  ),
                )

      const body =
        picked.phase === 'idle'
          ? h('div', { style: styles.paneHint }, t('changes.pick'))
          : picked.phase === 'loading'
            ? h('div', { style: styles.paneHint }, t('changes.loading'))
            : picked.phase === 'failed'
              ? h('div', { style: styles.paneHint }, `${t('changes.failed')} · ${picked.diff}`)
              : picked.diff === ''
                ? h('div', { style: styles.paneHint }, t('changes.empty'))
                : h(
                    'pre',
                    { style: styles.paneDiff, 'data-changes-diff': '' },
                    picked.diff.split('\n').map((line, index) =>
                      h('div', { key: index, style: diffLineStyle(line) }, line === '' ? ' ' : line),
                    ),
                  )

      return h(
        'div',
        { style: styles.pane, 'data-dsh-git-bar-pane': '' },
        head,
        files,
        picked.truncated ? h('div', { style: styles.paneHint }, t('changes.truncated')) : null,
        body,
      )
    }

    /* ============================== history view ============================== */

    /** 历史视图独占的样式；状态条那套 `styles` 仍归状态条使用。 */
    const historyStyles = {
      // 顶层：主对话区标签页里的一整块，自己管滚动，不把外层撑高。
      view: {
        display: 'flex',
        flexDirection: 'column',
        flex: '1 1 auto',
        minHeight: 0,
        maxHeight: 'calc(100vh - 210px)',
        border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
        borderRadius: '10px',
        overflow: 'hidden',
      },
      head: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 10px',
        flex: 'none',
        borderBottom: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
      },
      title: { fontWeight: 600, flex: 'none' },
      count: {
        flex: 'none',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
      },
      filter: {
        flex: '1 1 auto',
        minWidth: 0,
        padding: '3px 8px',
        font: 'inherit',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-primary, inherit)',
        background: 'var(--dsw-alias-bg-layer-2, #f3f4f6)',
        border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
        borderRadius: '6px',
      },
      filterRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px 6px',
        flex: 'none',
        borderBottom: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
      },
      chipWrap: { position: 'relative', flex: 'none' },
      chip: {
        display: 'inline-flex',
        alignItems: 'center',
        maxWidth: '190px',
        padding: '2px 8px',
        font: 'inherit',
        fontSize: '11.5px',
        lineHeight: '18px',
        color: 'var(--dsw-alias-label-secondary, #6b7280)',
        background: 'none',
        border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
        borderRadius: '999px',
        cursor: 'pointer',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      chipActive: {
        color: 'var(--dsw-alias-state-business-primary, #1d4ed8)',
        borderColor: 'var(--dsw-alias-state-business-primary, #1d4ed8)',
      },
      menu: {
        position: 'absolute',
        top: 'calc(100% + 4px)',
        left: 0,
        zIndex: 20,
        minWidth: '200px',
        maxWidth: '320px',
        maxHeight: 'calc(100vh - 96px)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
        borderRadius: '8px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
      },
      menuSearch: {
        flex: 'none',
        padding: '5px',
        borderBottom: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
      },
      menuSearchInput: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '3px 6px',
        font: 'inherit',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-primary, inherit)',
        background: 'var(--dsw-alias-bg-layer-2, #f5f6f8)',
        border: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
        borderRadius: '6px',
        outline: 'none',
      },
      menuList: {
        flex: '1 1 auto',
        minHeight: 0,
        maxHeight: '240px',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        display: 'flex',
        flexDirection: 'column',
        padding: '4px',
      },
      menuHint: {
        padding: '6px 8px',
        fontSize: '11.5px',
        color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
      },
      menuItem: {
        padding: '4px 8px',
        font: 'inherit',
        fontSize: '12px',
        textAlign: 'left',
        color: 'var(--dsw-alias-label-primary, inherit)',
        background: 'none',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      menuItemActive: { background: 'var(--dsw-alias-interactive-bg-active, #eef2f7)' },
      body: { display: 'flex', flex: '1 1 auto', minHeight: 0 },
      list: {
        flex: '1 1 52%',
        minWidth: 0,
        overflow: 'auto',
        padding: '4px 0',
      },
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '0 8px 0 4px',
        height: `${GRAPH_ROW_H}px`,
        border: 'none',
        background: 'none',
        font: 'inherit',
        fontSize: '12.5px',
        textAlign: 'left',
        color: 'inherit',
        cursor: 'pointer',
      },
      rowActive: { background: 'var(--dsw-alias-interactive-bg-active, #eef2f7)' },
      subject: {
        flex: '1 1 auto',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      refs: { display: 'flex', gap: '4px', flex: 'none', maxWidth: '45%', overflow: 'hidden' },
      ref: {
        flex: 'none',
        fontSize: '10px',
        lineHeight: '15px',
        padding: '0 5px',
        borderRadius: '999px',
        border: '1px solid currentColor',
        maxWidth: '150px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      meta: {
        flex: 'none',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
        maxWidth: '110px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      when: {
        flex: 'none',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
        width: '86px',
        textAlign: 'right',
      },
      detail: {
        flex: '1 1 48%',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
        overflow: 'hidden',
      },
      detailHead: {
        flex: 'none',
        padding: '8px 10px 0',
        display: 'flex',
        alignItems: 'baseline',
        gap: '6px',
      },
      detailSubject: { fontWeight: 600, flex: '1 1 auto', minWidth: 0, wordBreak: 'break-word' },
      detailHash: {
        flex: 'none',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
      },
      detailMeta: {
        flex: 'none',
        padding: '2px 10px 6px',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
      },
      detailBody: {
        flex: 'none',
        maxHeight: '132px',
        overflow: 'auto',
        margin: 0,
        padding: '0 10px 8px',
        font: 'inherit',
        fontSize: '12px',
        lineHeight: '18px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      },
      section: {
        flex: 'none',
        padding: '4px 10px',
        fontSize: '11px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-secondary, #6b7280)',
        borderTop: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
      },
      files: { flex: '0 1 auto', minHeight: 0, overflow: 'auto', padding: '0 4px 4px' },
      file: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: '100%',
        padding: '3px 6px',
        border: 'none',
        background: 'none',
        font: 'inherit',
        fontSize: '12px',
        textAlign: 'left',
        color: 'inherit',
        cursor: 'pointer',
      },
      fileActive: { background: 'var(--dsw-alias-interactive-bg-active, #eef2f7)', borderRadius: '6px' },
      fileStatus: {
        flex: 'none',
        width: '12px',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
      },
      filePath: {
        flex: '1 1 auto',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        direction: 'rtl',
        textAlign: 'left',
      },
      fileStat: {
        flex: 'none',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
      },
      diff: {
        flex: '1 1 auto',
        minHeight: '120px',
        overflow: 'auto',
        margin: 0,
        padding: '8px 10px',
        borderTop: '1px solid var(--dsw-alias-border-l2, #e5e7eb)',
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
        fontSize: '11.5px',
        lineHeight: '17px',
        whiteSpace: 'pre',
      },
      hint: {
        padding: '10px',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-tertiary, #9ca3af)',
      },
    }

    /**
     * 给一批「新到旧」的提交分配 lane 与行内连线。
     *
     * `lanes[i]` 记这条 lane 此刻正在等哪一笔提交（它的子提交已经画过了）。
     * 从上往下走：提交落在第一个等它的 lane 上，没有就开一条新 lane；
     * 第一个父提交续在当前 lane，其余父提交各开一条（或复用已在等它的那条）lane。
     * 每条 lane 一个颜色，整条线同色，lane 关掉时颜色回收给后面的线复用。
     *
     * 行内边（edge）三种：`into` 从行顶收到节点，`out` 从节点落到行底，
     * `pass` 整行贯穿——这样节点附近不会被整高的直线盖住。
     *
     * @param commits - 提交数组，必须新到旧、且每项带 `hash` 与 `parents`。
     * @returns 每行 `{ commit, lane, color, edges, merge }`。
     */
    function layoutGraph(commits) {
      const rows = []
      let lanes = []
      let laneColor = []
      const freed = []
      let nextColor = 0

      /** 取一个回收得最小的颜色，让调色板保持紧凑。 */
      const openColor = () => {
        if (freed.length === 0) return nextColor++
        const color = Math.min(...freed)
        freed.splice(freed.indexOf(color), 1)
        return color
      }

      const freeColor = (color) => {
        if (typeof color === 'number' && !freed.includes(color)) freed.push(color)
      }

      /** 给一笔还没人等的提交开一条 lane。 */
      const openLane = (hash) => {
        let lane = lanes.indexOf(null)
        if (lane === -1) {
          lane = lanes.length
          lanes.push(null)
          laneColor.push(null)
        }
        lanes[lane] = hash
        laneColor[lane] = openColor()
        return lane
      }

      for (const commit of commits) {
        const hash = typeof commit?.hash === 'string' ? commit.hash : ''
        if (hash === '') continue
        const parents = Array.isArray(commit.parents) ? commit.parents.filter((item) => typeof item === 'string' && item !== '') : []
        const awaited = lanes.indexOf(hash)
        const awaitedBefore = awaited !== -1
        const lane = awaited === -1 ? openLane(hash) : awaited
        const before = lanes.slice()
        const beforeColor = laneColor.slice()
        const color = laneColor[lane]

        // 两条 lane 同时在等这笔提交（分叉后又汇合）：多出来的并进当前这条。
        for (let index = 0; index < lanes.length; index += 1) {
          if (index !== lane && lanes[index] === hash) {
            freeColor(laneColor[index])
            lanes[index] = null
            laneColor[index] = null
          }
        }

        let continuation = -1
        const extra = []
        if (parents.length === 0) {
          // 根提交：这条线到此为止。
          freeColor(laneColor[lane])
          lanes[lane] = null
          laneColor[lane] = null
        } else {
          const first = parents[0]
          // 第一个父提交如果已经有一条 lane 在等，两条线在祖先处合并：留靠左的那条。
          const other = lanes.findIndex((item, index) => item === first && index !== lane)
          if (other === -1) {
            lanes[lane] = first
            continuation = lane
          } else {
            const keep = Math.min(lane, other)
            const drop = Math.max(lane, other)
            lanes[keep] = first
            freeColor(laneColor[drop])
            lanes[drop] = null
            laneColor[drop] = null
            continuation = keep
          }
          // 合并提交的其余父提交：复用已在等它的 lane，否则开新的。
          for (let index = 1; index < parents.length; index += 1) {
            const existing = lanes.findIndex((item) => item === parents[index])
            extra.push(existing === -1 ? openLane(parents[index]) : existing)
          }
        }

        const edges = []
        for (let index = 0; index < before.length; index += 1) {
          const waiting = before[index]
          if (waiting === null) continue
          if (waiting === hash) {
            // 新开的 lane 上面没有线：最新提交、分支尖端不该往下拖一截。
            if (index === lane && !awaitedBefore) continue
            edges.push({ from: index, to: lane, color: beforeColor[index], kind: 'into' })
          } else {
            const to = lanes[index] === waiting ? index : lanes.indexOf(waiting)
            if (to !== -1) edges.push({ from: index, to, color: beforeColor[index], kind: 'pass' })
          }
        }
        if (continuation !== -1) {
          edges.push({ from: lane, to: continuation, color: laneColor[continuation], kind: 'out' })
        }
        for (const target of extra) {
          edges.push({ from: lane, to: target, color: laneColor[target], kind: 'out' })
        }

        rows.push({ commit, lane, color, edges, merge: parents.length >= 2 })

        // 尾部空 lane 剪掉，图列宽度才是真实占用的列数。
        while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
          lanes.pop()
          laneColor.pop()
        }
      }

      return rows
    }

    /**
     * 这批行一共占几条 lane。
     * @param rows - `layoutGraph` 的结果。
     * @returns 至少 1 的 lane 数。
     */
    function graphLaneCount(rows) {
      let count = 1
      for (const row of rows) {
        count = Math.max(count, row.lane + 1)
        for (const edge of row.edges) count = Math.max(count, edge.from + 1, edge.to + 1)
      }
      return count
    }

    /**
     * 一行提交的图列：贯穿的直线、进出节点的曲线，最后是节点本身。
     * @param props - `{ row, lanes }`，`lanes` 是整批的 lane 数，保证每行同宽。
     */
    function GraphCell(props) {
      const row = props.row
      const lanes = Math.max(1, Number(props.lanes) || 1)
      const width = lanes * LANE_W
      const middle = GRAPH_ROW_H / 2
      const xOf = (lane) => lane * LANE_W + LANE_W / 2
      const children = []

      row.edges.forEach((edge, index) => {
        const x1 = xOf(edge.from)
        const x2 = xOf(edge.to)
        const y1 = edge.kind === 'out' ? middle : 0
        const y2 = edge.kind === 'into' ? middle : GRAPH_ROW_H
        const d =
          x1 === x2
            ? `M${x1} ${y1}L${x2} ${y2}`
            : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`
        children.push(
          h('path', {
            key: `edge-${index}`,
            d,
            fill: 'none',
            stroke: LANE_COLORS[Math.abs(edge.color ?? 0) % LANE_COLORS.length],
            strokeWidth: 1.6,
            strokeLinecap: 'round',
          }),
        )
      })

      children.push(
        h('circle', {
          key: 'node',
          cx: xOf(row.lane),
          cy: middle,
          r: row.merge ? 4 : 3.4,
          fill: LANE_COLORS[Math.abs(row.color ?? 0) % LANE_COLORS.length],
          stroke: row.merge ? 'none' : 'var(--dsw-alias-bg-base, #fff)',
          strokeWidth: row.merge ? 0 : 1.2,
        }),
      )

      return h(
        'svg',
        {
          width,
          height: GRAPH_ROW_H,
          viewBox: `0 0 ${width} ${GRAPH_ROW_H}`,
          style: { flex: 'none', display: 'block' },
          'aria-hidden': 'true',
          'data-history-graph': '',
        },
        children,
      )
    }

    /**
     * ref 徽章的配色：本地分支、远端分支、tag、HEAD 各一档。
     * @param kind - Host 给的 `kind`。
     * @returns 一个颜色。
     */
    function refBadgeColor(kind) {
      if (kind === 'tag') return 'var(--dsw-alias-state-warn-label, #b45309)'
      if (kind === 'remote') return 'var(--dsw-alias-state-business-primary, #1d4ed8)'
      if (kind === 'head') return 'var(--dsw-alias-state-success-primary, #15803d)'
      return 'var(--dsw-alias-label-secondary, #6b7280)'
    }

    /**
     * 把 ISO 时间写成「今天 19:15 / 昨天 19:15 / 10/27 19:15」。
     * @param when - Host 返回的 ISO 8601 字符串。
     * @param t - 词典函数。
     * @returns 可显示的文字；解析不出来时给空串。
     */
    function formatWhen(when, t) {
      const value = Date.parse(String(when ?? ''))
      if (!Number.isFinite(value)) return ''
      const then = new Date(value)
      const now = new Date()
      const pad = (input) => String(input).padStart(2, '0')
      const clock = `${pad(then.getHours())}:${pad(then.getMinutes())}`
      const sameDay = (left, right) => left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()
      if (sameDay(then, now)) return `${t('history.today')} ${clock}`
      const yesterday = new Date(now.getTime() - 86_400_000)
      if (sameDay(then, yesterday)) return `${t('history.yesterday')} ${clock}`
      const date = then.getFullYear() === now.getFullYear() ? `${pad(then.getMonth() + 1)}/${pad(then.getDate())}` : `${then.getFullYear()}/${pad(then.getMonth() + 1)}/${pad(then.getDate())}`
      return `${date} ${clock}`
    }

    /**
     * 「Git」主对话区标签页：左边分叉图谱 + 提交列表，右边提交详情与逐文件 diff。
     * @param props - 槽位 props；`sessionId` 由会话视图注入，`t` 与 `readCwd` 由注册处传入。
     */
    function HistoryView(props) {
      const t = typeof props.t === 'function' ? props.t : fallbackT
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      const readCwd = typeof props.readCwd === 'function' ? props.readCwd : () => undefined
      const dir = readCwd() ?? ''

      const [page, setPage] = React.useState({ limit: HISTORY_PAGE, nonce: 0, branch: '', author: '' })
      const [log, setLog] = React.useState({ phase: 'loading', commits: [], hasMore: false, reason: '', error: '' })
      const [filter, setFilter] = React.useState('')
      const [picked, setPicked] = React.useState('')
      const [detail, setDetail] = React.useState({ phase: 'idle', subject: '', body: '', short: '', author: '', when: '', files: [], error: '', truncated: false })
      const [pickedPath, setPickedPath] = React.useState('')
      const [diff, setDiff] = React.useState({ phase: 'idle', text: '', truncated: false })
      const [menu, setMenu] = React.useState('')
      const [menuQuery, setMenuQuery] = React.useState('')
      const [branches, setBranches] = React.useState([])
      const [authors, setAuthors] = React.useState([])
      const [authorRows, setAuthorRows] = React.useState([])
      const [authorPhase, setAuthorPhase] = React.useState('idle')

      const queryFor = (extra) => {
        const params = new URLSearchParams({ sessionId })
        if (dir !== '') params.set('dir', dir)
        for (const key of Object.keys(extra ?? {})) {
          const value = extra[key]
          if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
        }
        return params.toString()
      }

      const listRef = React.useRef(null)
      const loadMore = () => setPage((current) => ({ ...current, limit: current.limit + HISTORY_PAGE }))

      // 滚到底部附近就续一页，不用手动点「加载更多」。
      const onListScroll = (event) => {
        if (log.phase !== 'ready' || !log.hasMore) return
        const node = event?.currentTarget
        if (!node || typeof node.scrollTop !== 'number') return
        if (node.scrollHeight - node.scrollTop - node.clientHeight > HISTORY_SCROLL_SLACK) return
        loadMore()
      }

      const getJson = async (route, extra) => {
        const response = await fetch(`${route}?${queryFor(extra)}`, {
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.message ?? body.error ?? `HTTP ${response.status}`)
        return body
      }

      React.useEffect(() => {
        let live = true
        setLog({ phase: 'loading', commits: [], hasMore: false, reason: '', error: '' })
        getJson(LOG_ROUTE, { limit: page.limit, branch: page.branch, author: page.author })
          .then((body) => {
            if (!live) return
            setLog({
              phase: 'ready',
              commits: Array.isArray(body.commits) ? body.commits : [],
              hasMore: body.hasMore === true,
              reason: typeof body.reason === 'string' ? body.reason : '',
              error: '',
            })
          })
          .catch((error) => {
            if (!live) return
            setLog({ phase: 'failed', commits: [], hasMore: false, reason: '', error: error instanceof Error ? error.message : String(error) })
          })
        return () => {
          live = false
        }
      }, [sessionId, dir, page.limit, page.nonce, page.branch, page.author])

      // 一页装不满可视区（大窗口）时自动再要一页，否则没有滚动条也就没有滚动事件。
      React.useEffect(() => {
        if (log.phase !== 'ready' || !log.hasMore) return
        const node = listRef.current
        if (!node || typeof node.clientHeight !== 'number' || node.clientHeight <= 0) return
        if (typeof node.scrollHeight !== 'number') return
        if (node.scrollHeight > node.clientHeight + HISTORY_SCROLL_SLACK) return
        loadMore()
      }, [log.phase, log.hasMore, log.commits.length])

      // 分支下拉第一次打开时才拉，失败也不影响主列表。
      React.useEffect(() => {
        if (menu !== 'branch' || branches.length > 0) return
        let live = true
        getJson(BRANCHES_ROUTE, {})
          .then((body) => {
            if (!live) return
            setBranches(
              (Array.isArray(body.branches) ? body.branches : [])
                .map((branch) => String(branch?.name ?? ''))
                .filter((name) => name !== ''),
            )
          })
          .catch(() => {
            if (live) setBranches([])
          })
        return () => {
          live = false
        }
      }, [menu, branches.length])

      // 提交人候选取整条历史：第一次打开提交人下拉时向 Host 要一次全量作者。
      // 拉不到（旧版 Host、非仓库）就退回从已加载提交里累积的名单，不阻塞筛选。
      React.useEffect(() => {
        if (menu !== 'author' || authorPhase !== 'idle') return
        let live = true
        setAuthorPhase('loading')
        getJson(AUTHORS_ROUTE, {})
          .then((body) => {
            if (!live) return
            setAuthorRows(
              (Array.isArray(body.authors) ? body.authors : [])
                .map((row) => ({
                  name: String(row?.name ?? '').trim(),
                  count: Number(row?.count ?? 0),
                }))
                .filter((row) => row.name !== ''),
            )
            setAuthorPhase('ready')
          })
          .catch(() => {
            if (!live) return
            setAuthorRows([])
            setAuthorPhase('failed')
          })
        return () => {
          live = false
        }
      }, [menu, authorPhase])

      // 提交人候选从已加载的提交里累积，翻页后仍记得前面出现过的作者。
      React.useEffect(() => {
        if (log.phase !== 'ready') return
        const names = log.commits
          .map((commit) => String(commit?.author ?? '').trim())
          .filter((name) => name !== '')
        if (names.length === 0) return
        setAuthors((current) => {
          const known = new Set(current)
          let grew = false
          for (const name of names) {
            if (known.has(name)) continue
            known.add(name)
            grew = true
          }
          return grew ? Array.from(known).sort((left, right) => left.localeCompare(right)) : current
        })
      }, [log.phase, log.commits])

      React.useEffect(() => {
        if (picked === '') {
          setDetail({ phase: 'idle', subject: '', body: '', short: '', author: '', when: '', files: [], error: '', truncated: false })
          return () => {}
        }
        let live = true
        setDetail({ phase: 'loading', subject: '', body: '', short: '', author: '', when: '', files: [], error: '', truncated: false })
        getJson(COMMIT_ROUTE, { hash: picked })
          .then((body) => {
            if (!live) return
            setDetail({
              phase: 'ready',
              subject: String(body.subject ?? ''),
              body: String(body.body ?? ''),
              short: String(body.short ?? ''),
              author: String(body.author ?? ''),
              when: String(body.when ?? ''),
              files: Array.isArray(body.files) ? body.files : [],
              error: '',
              truncated: body.truncated === true,
            })
          })
          .catch((error) => {
            if (!live) return
            setDetail({ phase: 'failed', subject: '', body: '', short: '', author: '', when: '', files: [], error: error instanceof Error ? error.message : String(error), truncated: false })
          })
        return () => {
          live = false
        }
      }, [picked, sessionId, dir])

      React.useEffect(() => {
        if (picked === '' || pickedPath === '') {
          setDiff({ phase: 'idle', text: '', truncated: false })
          return () => {}
        }
        let live = true
        setDiff({ phase: 'loading', text: '', truncated: false })
        getJson(COMMIT_DIFF_ROUTE, { hash: picked, path: pickedPath })
          .then((body) => {
            if (!live) return
            setDiff({ phase: 'ready', text: String(body.diff ?? ''), truncated: body.truncated === true })
          })
          .catch((error) => {
            if (!live) return
            setDiff({ phase: 'failed', text: error instanceof Error ? error.message : String(error), truncated: false })
          })
        return () => {
          live = false
        }
      }, [picked, pickedPath, sessionId, dir])

      const rows = layoutGraph(log.commits)
      const lanes = graphLaneCount(rows)
      const needle = filter.trim().toLowerCase()
      const visible =
        needle === ''
          ? rows
          : rows.filter((row) => {
              const commit = row.commit
              return [commit.hash, commit.short, commit.subject, commit.author]
                .map((value) => String(value ?? '').toLowerCase())
                .some((value) => value.includes(needle))
            })

      const head = h(
        'div',
        { style: historyStyles.head },
        h('span', { style: historyStyles.title }, t('history.title')),
        h(
          'span',
          { style: historyStyles.count },
          log.phase === 'ready' && log.reason !== 'not-a-repository'
            ? t('history.count').replace('{count}', String(log.commits.length))
            : '',
        ),
        h('input', {
          type: 'search',
          value: filter,
          placeholder: t('history.filter'),
          'aria-label': t('history.filter'),
          style: historyStyles.filter,
          'data-history-filter': '',
          onChange: (event) => setFilter(event.target.value),
        }),
        h(
          'button',
          {
            type: 'button',
            style: styles.paneAction,
            title: t('history.refresh'),
            onClick: () => setPage({ limit: HISTORY_PAGE, nonce: page.nonce + 1 }),
          },
          t('history.refresh'),
        ),
      )

      const applyFilter = (kind, value) =>
        setPage((current) => ({
          limit: HISTORY_PAGE,
          nonce: current.nonce + 1,
          branch: kind === 'branch' ? String(value) : current.branch,
          author: kind === 'author' ? String(value) : current.author,
        }))

      const closeMenu = () => {
        setMenu('')
        setMenuQuery('')
      }

      const filterChip = (kind, label, allLabel, options) => {
        // 面板里带搜索框：分支和提交人都可能成百上千，只能打字找。
        const needle = menuQuery.trim().toLowerCase()
        const items = [{ value: '', label: allLabel }].concat(
          options.map((option) => ({ value: option, label: option })),
        )
        const shown =
          needle === ''
            ? items
            : items.filter((item) => item.label.toLowerCase().includes(needle))
        return h(
          'div',
          { style: historyStyles.chipWrap },
          h(
            'button',
            {
              type: 'button',
              style: page[kind] === '' ? historyStyles.chip : { ...historyStyles.chip, ...historyStyles.chipActive },
              title: label,
              'aria-haspopup': 'listbox',
              'aria-expanded': menu === kind ? 'true' : 'false',
              'data-history-chip': kind,
              onClick: () => {
                if (menu === kind) closeMenu()
                else {
                  setMenu(kind)
                  setMenuQuery('')
                }
              },
            },
            page[kind] === '' ? allLabel : page[kind],
          ),
          menu !== kind
            ? null
            : h(
                'div',
                { style: historyStyles.menu, role: 'listbox', 'data-history-menu': kind },
                h(
                  'div',
                  { style: historyStyles.menuSearch },
                  h('input', {
                    type: 'search',
                    value: menuQuery,
                    placeholder: kind === 'branch' ? t('history.searchBranch') : t('history.searchAuthor'),
                    'aria-label': label,
                    style: historyStyles.menuSearchInput,
                    'data-history-menu-search': kind,
                    autoFocus: true,
                    onChange: (event) => setMenuQuery(event.target.value),
                    onKeyDown: (event) => {
                      if (event.key === 'Escape') closeMenu()
                    },
                  }),
                ),
                h(
                  'div',
                  { style: historyStyles.menuList, 'data-history-menu-list': kind },
                  shown.length === 0
                    ? h('div', { style: historyStyles.menuHint }, t('history.noOption'))
                    : shown.map((item) =>
                        h(
                          'button',
                          {
                            key: `${kind}:${item.value}`,
                            type: 'button',
                            role: 'option',
                            'aria-selected': page[kind] === item.value ? 'true' : 'false',
                            'data-history-option': item.value,
                            style:
                              page[kind] === item.value
                                ? { ...historyStyles.menuItem, ...historyStyles.menuItemActive }
                                : historyStyles.menuItem,
                            title: item.label,
                            onClick: () => {
                              applyFilter(kind, item.value)
                              closeMenu()
                            },
                          },
                          item.label,
                        ),
                      ),
                ),
              ),
        )
      }

      const hasFilters = page.branch !== '' || page.author !== ''
      // Host 的全量作者优先；同名的不同邮箱只留一条，避免下拉里出现重复项。
      const authorOptions =
        authorRows.length > 0
          ? Array.from(new Set(authorRows.map((row) => row.name)))
          : authors
      const filterRow = h(
        'div',
        { style: historyStyles.filterRow, 'data-history-filters': '' },
        filterChip('branch', t('history.filterBranch'), t('history.allBranches'), branches),
        filterChip('author', t('history.filterAuthor'), t('history.allAuthors'), authorOptions),
        hasFilters
          ? h(
              'button',
              {
                type: 'button',
                style: historyStyles.chip,
                title: t('history.reset'),
                'data-history-reset': '',
                onClick: () => setPage({ limit: HISTORY_PAGE, nonce: page.nonce + 1, branch: '', author: '' }),
              },
              t('history.reset'),
            )
          : null,
      )

      const list =
        log.phase === 'loading'
          ? h('div', { style: historyStyles.hint }, t('history.loading'))
          : log.phase === 'failed'
            ? h('div', { style: historyStyles.hint }, `${t('history.failed')} · ${log.error}`)
            : log.commits.length === 0
              ? h(
                  'div',
                  { style: historyStyles.hint },
                  log.reason === 'not-a-repository'
                    ? t('history.notRepository')
                    : hasFilters
                      ? t('history.nomatch')
                      : t('history.empty'),
                )
              : visible.length === 0
                ? h('div', { style: historyStyles.hint }, t('history.nomatch'))
                : h(
                    'div',
                    null,
                    visible.map((row) => {
                      const commit = row.commit
                      const refs = Array.isArray(commit.refs) ? commit.refs : []
                      return h(
                        'button',
                        {
                          key: commit.hash,
                          type: 'button',
                          'data-history-commit': commit.hash,
                          style: picked === commit.hash ? { ...historyStyles.row, ...historyStyles.rowActive } : historyStyles.row,
                          title: `${commit.hash}\n${commit.subject ?? ''}`,
                          onClick: () => {
                            setPicked(commit.hash)
                            setPickedPath('')
                          },
                        },
                        h(GraphCell, { row, lanes }),
                        h('span', { style: historyStyles.subject }, String(commit.subject ?? commit.short ?? '')),
                        refs.length === 0
                          ? null
                          : h(
                              'span',
                              { style: historyStyles.refs },
                              refs.map((ref, index) =>
                                h(
                                  'span',
                                  {
                                    key: `${ref?.name ?? ''}:${index}`,
                                    style: { ...historyStyles.ref, color: refBadgeColor(ref?.kind) },
                                    title: String(ref?.name ?? ''),
                                  },
                                  String(ref?.name ?? ''),
                                ),
                              ),
                            ),
                        h('span', { style: historyStyles.meta }, String(commit.author ?? '')),
                        h('span', { style: historyStyles.when }, formatWhen(commit.when, t)),
                      )
                    }),
                    log.hasMore
                      ? h('div', { style: historyStyles.hint, 'data-history-more': '' }, t('history.more'))
                      : null,
                  )

      const files =
        detail.files.length === 0
          ? h('div', { style: historyStyles.hint }, t('history.noFiles'))
          : h(
              'div',
              { style: historyStyles.files },
              detail.files.map((file) =>
                h(
                  'button',
                  {
                    key: String(file?.path ?? ''),
                    type: 'button',
                    'data-history-file': String(file?.path ?? ''),
                    style: pickedPath === file?.path ? { ...historyStyles.file, ...historyStyles.fileActive } : historyStyles.file,
                    title: String(file?.path ?? ''),
                    onClick: () => setPickedPath(String(file?.path ?? '')),
                  },
                  h('span', { style: historyStyles.fileStatus }, String(file?.status ?? '')),
                  h('span', { style: historyStyles.filePath }, String(file?.path ?? '')),
                  h(
                    'span',
                    { style: historyStyles.fileStat },
                    file?.binary === true ? t('history.binary') : `+${file?.additions ?? 0} −${file?.deletions ?? 0}`,
                  ),
                ),
              ),
            )

      const diffPane =
        pickedPath === ''
          ? h('div', { style: historyStyles.hint }, t('history.diffPick'))
          : diff.phase === 'loading'
            ? h('div', { style: historyStyles.hint }, t('history.loading'))
            : diff.phase === 'failed'
              ? h('div', { style: historyStyles.hint }, `${t('history.failed')} · ${diff.text}`)
              : diff.text === ''
                ? h('div', { style: historyStyles.hint }, t('history.noFiles'))
                : h(
                    'pre',
                    { style: historyStyles.diff, 'data-history-diff': '' },
                    diff.text.split('\n').map((line, index) =>
                      h('div', { key: index, style: diffLineStyle(line) }, line === '' ? ' ' : line),
                    ),
                  )

      const detailPane =
        picked === ''
          ? h('div', { style: historyStyles.hint }, t('history.pick'))
          : detail.phase === 'loading'
            ? h('div', { style: historyStyles.hint }, t('history.loading'))
            : detail.phase === 'failed'
              ? h('div', { style: historyStyles.hint }, `${t('history.failed')} · ${detail.error}`)
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto' } },
                  h(
                    'div',
                    { style: historyStyles.detailHead },
                    h('span', { style: historyStyles.detailSubject, 'data-history-subject': '' }, detail.subject),
                    h('span', { style: historyStyles.detailHash }, detail.short),
                  ),
                  h('div', { style: historyStyles.detailMeta }, `${detail.author} · ${formatWhen(detail.when, t)}`),
                  detail.body === '' ? null : h('pre', { style: historyStyles.detailBody, 'data-history-body': '' }, detail.body),
                  h('div', { style: historyStyles.section }, t('history.files')),
                  files,
                  detail.truncated ? h('div', { style: historyStyles.hint }, t('history.truncated')) : null,
                  diffPane,
                )

      return h(
        'div',
        { style: historyStyles.view, 'data-dsh-git-bar-history': '' },
        head,
        filterRow,
        h(
          'div',
          { style: historyStyles.body },
          h(
            'div',
            { ref: listRef, style: historyStyles.list, 'data-history-list': '', onScroll: onListScroll },
            list,
          ),
          h('div', { style: historyStyles.detail, 'data-history-detail': '' }, detailPane),
        ),
      )
    }

    /** Read one optional Client service without failing the plugin when it is absent. */
    function service(ctx, name) {
      try {
        return typeof ctx.get === 'function' ? ctx.get(name) : undefined
      } catch {
        return undefined
      }
    }

    /** Client plugin body: dictionaries and the composer ambient row. */
    function apply(ctx) {
      const locale = service(ctx, 'locale')
      if (locale !== undefined && typeof locale.register === 'function') {
        ctx.effect(() => locale.register(NS, { zh, en }), 'git-bar: dictionaries')
      }
      const t =
        locale !== undefined && typeof locale.bind === 'function'
          ? locale.bind(NS)
          : (key) => (en[key] ?? key)

      /** The Session snapshot carries the directory the Host half re-resolves anyway. */
      const readCwdFor = (sessionId) => {
        const sessions = service(ctx, 'sessions')
        if (sessions === undefined) return undefined
        try {
          const row = sessions.list?.getSnapshot?.()?.byId?.[sessionId]
          return typeof row?.cwd === 'string' ? row.cwd : undefined
        } catch {
          return undefined
        }
      }

      /** Register the working-tree tab type once the Sidebar service exists. */
      let changesTabReady = false
      const ensureChangesTab = () => {
        if (changesTabReady) return true
        const tabs = service(ctx, 'sidebarRightTabs')
        if (tabs === undefined || typeof tabs.register !== 'function') return false
        try {
          const dispose = tabs.register({
            id: CHANGES_ID,
            kind: CHANGES_KIND,
            priority: 'builtin',
            patterns: ['dsh-git-bar://changes/**'],
            canOpen: (address) => parseChangesAddress(address) !== undefined,
            title: () => t('changes.title'),
          })
          ctx.slots.inject('sidebar.right.pane.tab', () =>
            ctx.slots.register(
              { name: 'sidebar.right.pane.tab', key: CHANGES_ID, locale: NS },
              ChangesPane,
            ),
          )
          if (typeof ctx.effect === 'function' && typeof dispose === 'function') {
            ctx.effect(() => dispose, 'git-bar: working-tree tab type')
          }
          changesTabReady = true
          return true
        } catch (error) {
          console.warn('[dsh-git-bar] 右侧栏 tab 注册失败:', String(error?.message ?? error))
          changesTabReady = true
          return false
        }
      }

      /** Open this Session's working tree in the right Sidebar. */
      const openChangesFor = (sessionId) => {
        const sidebarRight = service(ctx, 'sidebarRight')
        if (sidebarRight === undefined) return false
        if (!ensureChangesTab()) return false
        const cwd = readCwdFor(sessionId) ?? ''
        const address = `${CHANGES_ADDRESS}${encodeURIComponent(sessionId)}/${encodeURIComponent(cwd)}`
        try {
          // `openResource` requires the caller's own session context; the bar is
          // rendered for a session it does not own, so address that session.
          if (typeof sidebarRight.openResourceIn === 'function') {
            try {
              sidebarRight.openResourceIn(sessionId, address, {})
              return true
            } catch (error) {
              // 资源地址未被 claim 时，退回“按 kind 打开页面”的通道。
              if (typeof sidebarRight.openTabIn !== 'function') throw error
            }
          }
          if (typeof sidebarRight.openTabIn === 'function') {
            sidebarRight.openTabIn(sessionId, CHANGES_KIND, {})
            return true
          }
          if (typeof sidebarRight.openResource === 'function') {
            sidebarRight.openResource(address, {})
            return true
          }
          return false
        } catch (error) {
          console.warn('[dsh-git-bar] 无法打开改动面板:', String(error?.message ?? error))
          return false
        }
      }

      // 侧边栏服务可能晚于本插件就绪，先试一次，失败则在打开时补注册。
      ensureChangesTab()

      /**
       * 在一个工作树目录里开新会话。
       *
       * 会话的 cwd 在创建时就固定了，所以这里不是“移动当前会话”，而是让宿主
       * 在那个目录里开一个。目录不必先注册成工作区：`workspaces.create` 在 host
       * 侧按 realpath 幂等（同一目录返回已有记录），注册/复用之后
       * `uiWorkspace.openWorkspace` 会建会话并直接导航过去。
       *
       * @param path - 工作树的绝对路径。
       * @returns `opened`、`invalid-path`（目录已不存在）或 `unsupported`。
       */
      const openSessionIn = async (path) => {
        const workspaces = service(ctx, 'workspaces')
        const uiWorkspace = service(ctx, 'uiWorkspace')
        if (typeof workspaces?.create !== 'function') return 'unsupported'
        if (uiWorkspace === undefined || typeof uiWorkspace.openWorkspace !== 'function') return 'unsupported'
        try {
          const workspace = await workspaces.create({ path })
          if (typeof workspace?.workspaceId !== 'string' || workspace.workspaceId === '') return 'unsupported'
          await uiWorkspace.openWorkspace(workspace.workspaceId)
          return 'opened'
        } catch (error) {
          console.warn('[dsh-git-bar] 无法在该工作树中新建会话:', String(error?.message ?? error))
          const code = error?.rpcError?.code ?? error?.code
          return code === 'workspace/invalid-path' ? 'invalid-path' : 'unsupported'
        }
      }

      /** 复制一段文字到系统剪贴板，没有 Clipboard API 时退回 execCommand。 */
      const copyText = async (text) => {
        const value = String(text ?? '')
        if (value === '') return false
        try {
          if (navigator?.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(value)
            return true
          }
        } catch {
          // 落到下面的兼容路径：无 HTTPS 或权限被拒时仍能复制。
        }
        try {
          const area = document.createElement('textarea')
          area.value = value
          area.style.position = 'fixed'
          area.style.top = '-1000px'
          area.style.opacity = '0'
          document.body.appendChild(area)
          area.focus()
          area.select()
          const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') : false
          document.body.removeChild(area)
          return ok === true
        } catch {
          return false
        }
      }

      const register = () =>
        ctx.slots.register(
          {
            name: 'conversation.input.dock',
            id: 'git-bar',
            order: 20,
            locale: NS,
            inject: (sessionId) => ({
              sessionId,
              readCwd: () => readCwdFor(sessionId),
              openChanges: () => openChangesFor(sessionId),
              openSessionIn,
              copyText,
              t,
            }),
          },
          GitBar,
        )

      ctx.slots.inject('conversation.input.dock', register)

      /**
       * 主对话区的「Git 历史」标签页。和状态条共用同一份 cwd 读取逻辑，
       * 但它注册在 `conversation.view`：槽位自己给 `sessionId`，标签名走词典。
       */
      const registerView = () =>
        ctx.slots.register(
          {
            name: 'conversation.view',
            id: 'git-history',
            order: 20,
            locale: NS,
            label: () => t('history.tab'),
            inject: (sessionId) => ({
              sessionId,
              readCwd: () => readCwdFor(sessionId),
              t,
            }),
          },
          HistoryView,
        )

      ctx.slots.inject('conversation.view', registerView)
    }

    return {
      inject: ['slots'],
      apply,
      /* 测试钩子：分叉图谱的布局是纯函数，单独导出来直接在 Node 里断言，
         不必把整棵组件树渲染一遍。 */
      layoutGraph,
      graphLaneCount,
    }
  },
})
