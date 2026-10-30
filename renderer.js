const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M19.3 5.3A16.6 16.6 0 0 0 15.2 4l-.5 1a15.4 15.4 0 0 0-5.4 0l-.5-1a16.5 16.5 0 0 0-4.1 1.3C2.1 9.2 1.4 13 1.7 16.8a16.7 16.7 0 0 0 5.1 2.6l1.1-1.8c-.6-.2-1.2-.5-1.7-.8l.4-.3a11.9 11.9 0 0 0 10.8 0l.4.3c-.5.3-1.1.6-1.7.8l1.1 1.8a16.6 16.6 0 0 0 5.1-2.6c.4-4.4-.7-8.2-3-11.5ZM8.7 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z"/></svg>'

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') node.style.cssText = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
    else node.setAttribute(k, v)
  }
  for (const c of children) node.append(c)
  return node
}

function field(label, input, help) {
  return el('label', { style: 'display:flex;flex-direction:column;gap:4px;margin-bottom:12px' },
    el('span', { style: 'font-weight:600' }, label), input,
    ...(help ? [el('span', { class: 'muted', style: 'font-size:var(--text-sm)' }, help)] : []))
}

function openOptions(ctx) {
  return ctx.ui.modal({
    title: 'Discord Reader 옵션',
    width: 520,
    mount(root, close) {
      const s = ctx.settings.get() || {}
      const token = el('input', { class: 'input', type: 'password', placeholder: '봇 토큰', autocomplete: 'off' })
      token.value = s.botToken || ''
      const reveal = el('button', { class: 'btn small', type: 'button', onclick: () => { token.type = token.type === 'password' ? 'text' : 'password'; reveal.textContent = token.type === 'password' ? '보기' : '숨기기' } }, '보기')
      const guild = el('input', { class: 'input', placeholder: '예: 123456789012345678', inputmode: 'numeric' })
      guild.value = s.defaultGuildId || ''
      const max = el('input', { class: 'input', type: 'number', min: '1', max: '10000' })
      max.value = String(s.maxMessages ?? 1000)
      const status = el('div', { style: 'min-height:20px;margin:4px 0 12px;font-size:var(--text-sm)' })
      const guildList = el('div', { style: 'display:flex;flex-direction:column;gap:4px;margin-bottom:12px' })

      const setStatus = (cls, msg) => { status.className = cls; status.textContent = msg }

      const test = el('button', { class: 'btn small', type: 'button', onclick: async () => {
        setStatus('muted', '연결 확인 중...'); guildList.replaceChildren(); test.disabled = true
        try {
          const r = await ctx.channel.invoke('testConnection', { token: token.value })
          setStatus('ok-text', `연결됨: ${r.bot} · 서버 ${r.guilds.length}개 (클릭하면 기본 서버로 지정)`)
          for (const g of r.guilds) {
            guildList.append(el('button', { class: 'btn small', type: 'button', style: 'justify-content:flex-start', onclick: () => { guild.value = g.id } }, `${g.name}  ·  ${g.id}`))
          }
        } catch (e) { setStatus('error-text', String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
        finally { test.disabled = false }
      } }, '연결 테스트')

      const save = el('button', { class: 'btn small primary', type: 'button', onclick: async () => {
        const n = Math.round(Number(max.value))
        if (guild.value && !/^\d+$/.test(guild.value.trim())) return setStatus('error-text', '서버 ID는 숫자만 입력하세요.')
        if (!(n >= 1 && n <= 10000)) return setStatus('error-text', '최대 메시지 수는 1~10000 사이여야 합니다.')
        try {
          await ctx.settings.update({ botToken: token.value.trim(), defaultGuildId: guild.value.trim(), maxMessages: n })
          ctx.ui.toast('info', 'Discord Reader 옵션을 저장했습니다.')
          close()
        } catch (e) { setStatus('error-text', '저장 실패: ' + (e?.message || e)) }
      } }, '저장')

      root.append(
        field('봇 토큰', el('div', { style: 'display:flex;gap:6px;align-items:center' }, token, reveal), 'Developer Portal > Bot 에서 발급. Message Content Intent를 켜야 본문을 읽을 수 있습니다.'),
        field('기본 서버 ID', guild, 'AI가 서버를 지정하지 않을 때 사용합니다. 연결 테스트 후 목록에서 고를 수 있습니다.'),
        field('한 번에 가져올 최대 메시지 수', max),
        status, guildList,
        el('div', { style: 'display:flex;gap:8px;justify-content:flex-end' },
          test, el('button', { class: 'btn small', type: 'button', onclick: () => close() }, '취소'), save)
      )
    }
  })
}

export function activate(ctx) {
  const { html } = ctx.react
  const iconRef = (node) => { if (node && !node.firstChild) node.innerHTML = ICON }
  ctx.shell.registerSlot({
    id: 'sidebar.options',
    slot: 'sidebar.footer',
    order: 260,
    title: 'Discord 옵션',
    component: () => html`<button className="btn small nav-btn" title="Discord Reader 옵션" onClick=${() => openOptions(ctx)}>
      <span className="btn-icon" ref=${iconRef}></span><span className="btn-label">Discord</span>
    </button>`
  })
  ctx.registerCommand({ id: 'options', title: 'Discord Reader: 옵션 열기', run: () => openOptions(ctx) })
}
