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
      'worktree.notWorkspace': '该目录还不是工作区',
      'worktree.unsupported': '这台机器无法新建会话',
      'worktree.loading': '正在读取工作树…',
      'worktree.failed': '读取工作树失败',
      'worktree.clean': '干净',
      'worktree.dirty': '{count} 处改动',
      'worktree.count': '{count} 个工作树',
      'menu.occupied': '已在 {name} 中使用',
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
      'worktree.notWorkspace': 'not a workspace yet',
      'worktree.unsupported': 'cannot create a session here',
      'worktree.loading': 'Reading worktrees…',
      'worktree.failed': 'Could not read worktrees',
      'worktree.clean': 'clean',
      'worktree.dirty': '{count} changed',
      'worktree.count': '{count} worktrees',
      'menu.occupied': 'checked out in {name}',
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
        border: '1px solid var(--dsw-alias-border-secondary, #e5e7eb)',
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
        color: 'var(--dsw-alias-state-error-label, #b91c1c)',
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
    /**
     * Compare two directories for equality, ignoring a trailing separator.
     * @param left - one path.
     * @param right - the other path.
     * @returns true when both name the same directory textually.
     */
    function samePath(left, right) {
      const strip = (value) => String(value ?? '').replace(/[\\/]+$/, '')
      return strip(left) !== '' && strip(left) === strip(right)
    }

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
            error: result === 'not-workspace' ? t('worktree.notWorkspace') : t('worktree.unsupported'),
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
      if (line.startsWith('+')) return { color: 'var(--dsw-alias-state-success-label, #15803d)' }
      if (line.startsWith('-')) return { color: 'var(--dsw-alias-state-error-label, #b91c1c)' }
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
       * 在那个目录里开一个：目录必须已经是工作区，`uiWorkspace.openWorkspace`
       * 会建会话并直接导航过去。
       *
       * @param path - 工作树的绝对路径。
       * @returns `opened`、`not-workspace` 或 `unsupported`。
       */
      const openSessionIn = async (path) => {
        const workspaces = service(ctx, 'workspaces')
        const uiWorkspace = service(ctx, 'uiWorkspace')
        const items = workspaces?.list?.getSnapshot?.().items
        const target = (Array.isArray(items) ? items : []).find((item) => samePath(item.path, path))
        if (target === undefined) return 'not-workspace'
        if (uiWorkspace === undefined || typeof uiWorkspace.openWorkspace !== 'function') return 'unsupported'
        try {
          await uiWorkspace.openWorkspace(target.workspaceId)
          return 'opened'
        } catch (error) {
          console.warn('[dsh-git-bar] 无法在该工作树中新建会话:', String(error?.message ?? error))
          return 'unsupported'
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
    }

    return {
      inject: ['slots'],
      apply,
    }
  },
})
