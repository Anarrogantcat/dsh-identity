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
      #qqrefine-fab{position:fixed;left:0;top:0;z-index:2147483000;
        width:46px;height:46px;border-radius:50%;border:1px solid rgba(120,150,210,.45);
        background:linear-gradient(160deg,#1a2233,#0f1420);color:#dfe8fb;cursor:grab;
        box-shadow:0 6px 20px rgba(0,0,0,.45);font-size:20px;line-height:46px;text-align:center;
        user-select:none;-webkit-user-select:none;touch-action:none;-webkit-tap-highlight-color:transparent;
        will-change:transform;transform:translate3d(var(--x,0px),var(--y,0px),0);
        transition:box-shadow .15s ease, filter .15s ease, transform .12s ease}
      #qqrefine-fab:hover{filter:brightness(1.08);box-shadow:0 10px 26px rgba(77,141,255,.35)}
      #qqrefine-fab.dragging{cursor:grabbing;transition:box-shadow .15s ease;
        transform:translate3d(var(--x,0px),var(--y,0px),0) scale(1.06);box-shadow:0 16px 34px rgba(0,0,0,.55)}
      #qqrefine-fab:active{cursor:grabbing}
      #qqrefine-fab[data-open="1"]{background:linear-gradient(160deg,#2b4a7d,#1b2c4a)}
      #qqrefine-mask{position:fixed;inset:0;z-index:2147482999;background:rgba(6,10,18,.55);
        backdrop-filter:blur(2px);display:none}
      #qqrefine-mask[data-open="1"]{display:block}
      #qqrefine-wrap{position:fixed;z-index:2147483001;left:50%;top:50%;transform:translate(-50%,-50%);
        width:min(1000px,94vw);height:min(86vh,900px);background:#0f1420;border:1px solid #26314a;
        border-radius:14px;overflow:hidden;display:none;flex-direction:column;
        box-shadow:0 30px 80px rgba(0,0,0,.6)}
      #qqrefine-wrap[data-open="1"]{display:flex}
      #qqrefine-bar{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#151c2b;
        border-bottom:1px solid #26314a;color:#dbe5f7;font:13px/1.4 "Segoe UI","Microsoft YaHei",system-ui,sans-serif}
      #qqrefine-bar .grow{flex:1}
      #qqrefine-bar button{font:12.5px/1 inherit;padding:5px 11px;border-radius:7px;cursor:pointer;
        border:1px solid #2c3a58;background:#1b2537;color:#cfdcf3}
      #qqrefine-bar button:hover{background:#243149}
      #qqrefine-frame{flex:1;width:100%;border:0;background:#0f1420}
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
      fab.textContent = '🐟'
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
          <span>🐟 大肥鱼 · 身份系统</span>
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
