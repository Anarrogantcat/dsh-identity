/**
 * dsh-identity —— 浏览器半边：左侧栏入口（v2）
 *
 * 在 sidebar.panellist 注册一枚鲸鱼图标；点它，中间栏（main，键 = identity-panel）
 * 渲染身份面板。面板本体仍是宿主同源的 /qqbot-refine（右下角悬浮按钮用的同一张），
 * 这里只负责把它装进 DSH 原生布局：一条标题栏 + 一个铺满的 iframe。
 *
 * 旧的 🐟 悬浮按钮已撤掉——同一张面板不再有两个入口。
 */
window.__ModuleLoader__.load({
  id: 'dsh-identity',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const PANEL_ID = 'identity-panel'
    const PANEL_PATH = '/qqbot-refine'
    const LABEL = '大肥鱼'
    const TITLE = '大肥鱼 · 身份系统'

    const CSS = `
      .idn-root{position:relative;height:100%;min-height:0;box-sizing:border-box;display:flex;flex-direction:column;
        background:var(--dsw-alias-bg-base,#0f1420);color:var(--dsw-alias-label-primary,#e6ecf7);
        font:13px/1.4 "Segoe UI","Microsoft YaHei",system-ui,sans-serif}
      .idn-bar{display:flex;align-items:center;gap:8px;flex:none;height:44px;padding:0 12px;
        border-bottom:1px solid var(--dsw-alias-border-l1,rgba(38,49,74,.9));
        background:var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-layer-1,#151c2b))}
      .idn-brand{display:flex;align-items:center;gap:8px;min-width:0;font-weight:600;letter-spacing:.2px}
      .idn-brand svg{flex:none}
      .idn-brand span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
      .idn-grow{flex:1}
      .idn-btn{font:12.5px/1 inherit;padding:5px 11px;border-radius:8px;cursor:pointer;flex:none;
        border:1px solid var(--dsw-alias-border-l1,#22314c);background:transparent;
        color:var(--dsw-alias-label-secondary,#93a1bb);transition:.15s}
      .idn-btn:hover{color:var(--dsw-alias-label-primary,#e6ecf7);
        border-color:var(--dsw-alias-border-l2,#33507a);
        background:var(--dsw-alias-bg-layer-2,rgba(19,34,57,.6))}
      .idn-frame{flex:1;display:block;width:100%;min-height:0;border:0;background:#070b12}
    `

    /** 侧栏图标：一只圆头鲸鱼，描边风格，跟随 currentColor。 */
    function WhaleIcon(props) {
      const size = Math.max(12, Number(props && props.size) || 18)
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        style: { display: 'block' },
      },
      h('path', {
        d: 'M3.4 13.6c0-4 3.1-6.8 7.4-6.8 2.9 0 5.1 1.5 6.1 3.6l3.1-2.2v4.9c0 4.4-3.7 6.7-8.4 6.7S3.4 17.7 3.4 13.6Z',
      }),
      h('circle', { cx: 9.3, cy: 13.2, r: 0.95, fill: 'currentColor', stroke: 'none' }))
    }

    /** 中间栏面板：标题条 + 同源面板。 */
    function IdentityPanel() {
      const [nonce, setNonce] = React.useState(0)
      const src = PANEL_PATH + '?embed=1' + (nonce ? `&v=${nonce}` : '')
      return h('div', { className: 'idn-root' },
        h('style', null, CSS),
        h('div', { className: 'idn-bar' },
          h('span', { className: 'idn-brand' }, h(WhaleIcon, { size: 18 }), h('span', null, TITLE)),
          h('span', { className: 'idn-grow' }),
          h('button', {
            type: 'button',
            className: 'idn-btn',
            title: '重新加载面板',
            onClick: () => setNonce((n) => n + 1),
          }, '重新加载'),
          h('button', {
            type: 'button',
            className: 'idn-btn',
            title: '在新窗口打开',
            onClick: () => {
              try { window.open(PANEL_PATH, '_blank', 'noopener') } catch { /* ignore */ }
            },
          }, '新窗口')),
        h('iframe', {
          key: nonce,
          className: 'idn-frame',
          src,
          title: TITLE,
          allow: 'clipboard-write',
        }))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 40,
            label: () => LABEL,
          }, WhaleIcon))
        } catch (err) {
          console.warn('[dsh-identity] 侧栏入口注册失败:', err && err.message)
        }
        try {
          ctx.slots.inject('main', () => ctx.slots.register({
            name: 'main',
            key: PANEL_ID,
          }, IdentityPanel))
        } catch (err) {
          console.warn('[dsh-identity] 主面板注册失败:', err && err.message)
        }
      },
    }
  },
})
