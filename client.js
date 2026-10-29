/**
 * dsh-identity —— 浏览器半边：右下角悬浮按钮（🐟）
 * 点一下打开控制面板（iframe 指向宿主上的 /qqbot-refine 同源页面）。
 *
 * 只用 DOM + localStorage，不依赖任何 slot 契约，版本升级不易失效；
 * 面板本身仍是 loopback 页面，也可直接用浏览器打开同一路径。
 */
window.__ModuleLoader__.load({
  id: 'dsh-identity',
  factory: () => {
    const CSS = `
      /* v2：深海玻璃 + 青/紫点缀，和面板同一套语言 */
      #qqrefine-fab{position:fixed;left:0;top:0;z-index:2147483000;
        width:46px;height:46px;border-radius:16px;border:1px solid rgba(53,214,201,.38);display:flex;align-items:center;justify-content:center;
        background:linear-gradient(150deg,rgba(17,27,43,.96),rgba(9,15,26,.96));color:#eafffb;cursor:grab;
        box-shadow:0 10px 28px rgba(0,0,0,.45),inset 0 0 0 1px rgba(139,123,255,.12);
        font-size:21px;line-height:44px;text-align:center;
        backdrop-filter:blur(12px) saturate(1.2);-webkit-backdrop-filter:blur(12px) saturate(1.2);
        user-select:none;-webkit-user-select:none;touch-action:none;-webkit-tap-highlight-color:transparent;
        will-change:transform;transform:translate3d(var(--x,0px),var(--y,0px),0);
        transition:box-shadow .15s ease, border-color .15s ease, transform .12s ease}
      #qqrefine-fab::before{content:"";position:absolute;inset:-1px;border-radius:17px;pointer-events:none;
        background:radial-gradient(70% 70% at 28% 16%,rgba(53,214,201,.20),transparent 70%),
                   radial-gradient(60% 60% at 82% 88%,rgba(139,123,255,.18),transparent 72%)}
      #qqrefine-fab:hover{border-color:rgba(53,214,201,.7);
        box-shadow:0 14px 30px rgba(0,0,0,.5),0 0 18px rgba(53,214,201,.28),inset 0 0 0 1px rgba(139,123,255,.16)}
      #qqrefine-fab.dragging{cursor:grabbing;transition:box-shadow .15s ease;
        transform:translate3d(var(--x,0px),var(--y,0px),0) scale(1.06);box-shadow:0 20px 40px rgba(0,0,0,.55)}
      #qqrefine-fab:active{cursor:grabbing}
      #qqrefine-fab[data-open="1"]{background:linear-gradient(150deg,rgba(53,214,201,.32),rgba(139,123,255,.28));
        border-color:rgba(53,214,201,.75);color:#061018}
      #qqrefine-mask{position:fixed;inset:0;z-index:2147482999;background:rgba(4,8,14,.58);
        backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);display:none}
      #qqrefine-mask[data-open="1"]{display:block}
      #qqrefine-wrap{position:fixed;z-index:2147483001;left:50%;top:50%;transform:translate(-50%,-50%);
        width:min(1080px,94vw);height:min(88vh,920px);
        background:linear-gradient(180deg,rgba(9,14,24,.96),rgba(6,10,17,.98));
        border:1px solid rgba(53,214,201,.22);border-radius:18px;overflow:hidden;display:none;flex-direction:column;
        box-shadow:0 30px 90px rgba(0,0,0,.66),inset 0 0 0 1px rgba(139,123,255,.08);
        backdrop-filter:blur(18px) saturate(1.25);-webkit-backdrop-filter:blur(18px) saturate(1.25)}
      #qqrefine-wrap[data-open="1"]{display:flex}
      #qqrefine-bar{display:flex;align-items:center;gap:10px;padding:11px 14px;
        background:linear-gradient(180deg,rgba(13,21,35,.94),rgba(9,14,24,.82));
        border-bottom:1px solid rgba(30,43,68,.9);color:#e6eefc;
        font:13px/1.4 "Segoe UI","Microsoft YaHei",system-ui,sans-serif}
      #qqrefine-bar .brand{display:flex;align-items:center;gap:9px;font-weight:650;letter-spacing:.2px}
      #qqrefine-bar .brand .dot{width:24px;height:24px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;
        background:linear-gradient(150deg,rgba(53,214,201,.38),rgba(139,123,255,.32));
        box-shadow:inset 0 0 0 1px rgba(234,255,251,.18);font-size:13px}
      #qqrefine-bar .brand .tag{font-size:10px;letter-spacing:.14em;color:#061018;
        background:linear-gradient(90deg,#35d6c9,#8b7bff);border-radius:999px;padding:1px 8px}
      #qqrefine-bar .grow{flex:1}
      #qqrefine-bar button{font:12.5px/1 inherit;padding:6px 12px;border-radius:10px;cursor:pointer;
        border:1px solid #22314c;background:#101a2b;color:#dbe6f7;transition:.15s}
      #qqrefine-bar button:hover{background:#132239;border-color:#33507a;color:#eafffb}
      #qqrefine-bar button[data-act="close"]:hover{border-color:rgba(255,123,133,.5);color:#ffb0b8}
      #qqrefine-frame{flex:1;width:100%;border:0;background:#070b12}
    `

    function url() {
      // 与 DSH 同源，直接相对路径
      return '/qqbot-refine'
    }

    function mount() {
      if (document.getElementById('qqrefine-fab')) return

      const style = document.createElement('style')
      style.id = 'qqrefine-style'
      style.textContent = CSS
      document.head.appendChild(style)

      const fab = document.createElement('button')
      fab.id = 'qqrefine-fab'
      fab.title = '大肥鱼 · 身份系统（控制面板）\n拖动可以挪位置，双击标题栏没用的那种（笑）'
      fab.innerHTML = `<svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true" fill="none">
        <defs><linearGradient id="qwg" x1="8" y1="8" x2="40" y2="42"><stop stop-color="#8fe0ff"/><stop offset="1" stop-color="#3d7dff"/></linearGradient></defs>
        <path d="M9 27c0-8 6-13 15-13 6 0 10 3 12 7l7-5v10c0 9-8 14-18 14S9 36 9 27z" fill="url(#qwg)"/>
        <path d="M33 19c2-5 7-7 11-5" stroke="#c9ecff" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M11 24c-4 0-6 2-7 5" stroke="#c9ecff" stroke-width="2.2" stroke-linecap="round"/>
        <circle cx="19" cy="26" r="1.9" fill="#0b1626"/>
        <circle cx="18.3" cy="25.4" r=".6" fill="#eaf7ff"/>
        <path d="M27 34c2 2 5 3 8 2" stroke="#e6f6ff" stroke-opacity=".75" stroke-width="1.6" stroke-linecap="round"/>
      </svg>`
      fab.addEventListener('dragstart', (e) => e.preventDefault())
      document.body.appendChild(fab)

      // ── 拖动：pointer 事件 + rAF 合帧，松手才落盘；位移 <5px 视为点击 ──
      const POS_KEY = 'qqrefine:fabPos'
      const SIZE = 46
      const EDGE = 6
      const clampPos = (x, y) => ({
        x: Math.min(Math.max(EDGE, Math.round(x)), Math.max(EDGE, window.innerWidth - SIZE - EDGE)),
        y: Math.min(Math.max(EDGE, Math.round(y)), Math.max(EDGE, window.innerHeight - SIZE - EDGE)),
      })
      const applyPos = (p) => {
        fab.style.setProperty('--x', p.x + 'px')
        fab.style.setProperty('--y', p.y + 'px')
      }
      const loadPos = () => {
        try {
          const j = JSON.parse(localStorage.getItem(POS_KEY) || 'null')
          if (j && Number.isFinite(j.x) && Number.isFinite(j.y)) return clampPos(j.x, j.y)
        } catch { /* ignore */ }
        return clampPos(window.innerWidth - SIZE - 18, window.innerHeight - SIZE - 18)
      }
      const savePos = (p) => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)) } catch { /* ignore */ } }

      let pos = loadPos()
      applyPos(pos)

      let drag = null
      let raf = 0
      let pending = null
      let suppressClickAt = 0

      fab.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return
        const r = fab.getBoundingClientRect()
        drag = { id: e.pointerId, ox: e.clientX - r.left, oy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false }
        try { fab.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      })

      fab.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return
        if (!drag.moved) {
          if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return
          drag.moved = true
          fab.classList.add('dragging')
        }
        pending = clampPos(e.clientX - drag.ox, e.clientY - drag.oy)
        if (!raf) {
          raf = requestAnimationFrame(() => { raf = 0; if (pending) applyPos(pending) })
        }
        e.preventDefault()
      })

      const endDrag = (e) => {
        if (!drag) return
        const moved = drag.moved
        try { fab.releasePointerCapture(drag.id) } catch { /* ignore */ }
        drag = null
        fab.classList.remove('dragging')
        if (raf) { cancelAnimationFrame(raf); raf = 0 }
        if (pending) { pos = pending; applyPos(pos) }
        pending = null
        if (moved) {
          suppressClickAt = Date.now()
          try { localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch { /* ignore */ }
        }
      }
      fab.addEventListener('pointerup', endDrag)
      fab.addEventListener('pointercancel', endDrag)

      fab.addEventListener('click', (e) => {
        if (Date.now() - suppressClickAt < 350) { e.preventDefault(); e.stopPropagation(); return }
        toggle(true)
      })

      window.addEventListener('resize', () => {
        const next = clampPos(pos.x, pos.y)
        if (next.x !== pos.x || next.y !== pos.y) { pos = next; applyPos(pos); savePos(pos) }
      })

      const mask = document.createElement('div')
      mask.id = 'qqrefine-mask'
      mask.addEventListener('click', () => toggle(false))
      document.body.appendChild(mask)

      const wrap = document.createElement('div')
      wrap.id = 'qqrefine-wrap'
      wrap.innerHTML = `
        <div id="qqrefine-bar">
          <span class="brand"><span class="dot">🐟</span><span>大肥鱼 · 身份系统</span><span class="tag">v2</span></span>
          <span class="grow"></span>
          <button data-act="reload">重新加载</button>
          <button data-act="newtab">新窗口打开</button>
          <button data-act="close">关闭</button>
        </div>
        <iframe id="qqrefine-frame" src="about:blank" allow="clipboard-write"></iframe>
      `
      document.body.appendChild(wrap)

      wrap.querySelector('[data-act="close"]').addEventListener('click', () => toggle(false))
      wrap.querySelector('[data-act="reload"]').addEventListener('click', () => {
        const f = document.getElementById('qqrefine-frame')
        if (f) f.src = `${url()}?t=${Date.now()}`
      })
      wrap.querySelector('[data-act="newtab"]').addEventListener('click', () => window.open(url(), '_blank'))

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') toggle(false)
      })
    }

    let open = false
    function toggle(next) {
      const want = typeof next === 'boolean' ? next : !open
      open = want
      const wrap = document.getElementById('qqrefine-wrap')
      const mask = document.getElementById('qqrefine-mask')
      const fab = document.getElementById('qqrefine-fab')
      const frame = document.getElementById('qqrefine-frame')
      if (!wrap || !mask || !fab || !frame) return
      wrap.dataset.open = want ? '1' : '0'
      mask.dataset.open = want ? '1' : '0'
      fab.dataset.open = want ? '1' : '0'
      if (want && (frame.src === 'about:blank' || frame.src === '')) frame.src = url()
      try { localStorage.setItem('qqrefine:open', want ? '1' : '0') } catch { /* ignore */ }
    }

    return {
      inject: [],
      apply(ctx) {
        // 等 UI 成型再挂（DSH 的 DOM 是渐进渲染的）
        const start = () => {
          mount()
          try {
            if (localStorage.getItem('qqrefine:open') === '1') setTimeout(() => toggle(true), 800)
          } catch { /* ignore */ }
        }
        if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(start, 300)
        else window.addEventListener('DOMContentLoaded', () => setTimeout(start, 300), { once: true })
      },
    }
  },
})
