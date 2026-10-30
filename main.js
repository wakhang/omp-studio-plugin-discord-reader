'use strict'

const API = 'https://discord.com/api/v10'
const DISCORD_EPOCH = 1420070400000n
const CHANNEL_TYPES = { 0: 'text', 2: 'voice', 4: 'category', 5: 'announcement', 10: 'announcement-thread', 11: 'thread', 12: 'private-thread', 13: 'stage', 15: 'forum', 16: 'media' }
const READABLE_TYPES = new Set([0, 2, 5, 10, 11, 12, 13])

let ctx

function text(t, isError) { return { content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) } }

function settings() {
  const s = ctx.settings.get() || {}
  const token = String(s.botToken || '').trim().replace(/^Bot\s+/i, '')
  if (!token) throw new Error('봇 토큰이 설정되지 않았습니다. 설정 > 플러그인 > Discord Reader 에서 botToken을 입력하세요.')
  return { token, defaultGuildId: String(s.defaultGuildId || '').trim(), maxMessages: Number(s.maxMessages) || 1000 }
}

async function api(path, token, signal) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(API + path, { headers: { Authorization: 'Bot ' + token, 'User-Agent': 'DiscordBot (omp-studio discord-reader, 0.1.0)' }, signal })
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}))
      const wait = Math.ceil((Number(body.retry_after) || 1) * 1000)
      await new Promise(r => setTimeout(r, wait))
      continue
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const hint = res.status === 401 ? ' (토큰이 잘못됨)' : res.status === 403 ? ' (봇에 이 채널의 View Channel / Read Message History 권한이 없음)' : res.status === 404 ? ' (ID를 찾을 수 없음)' : ''
      throw new Error(`Discord API ${res.status}${hint}: ${path} ${body.slice(0, 300)}`)
    }
    return res.json()
  }
  throw new Error('Discord API 레이트 리밋이 계속됩니다: ' + path)
}

function guildIdOf(args, s) {
  const id = String(args.guildId || s.defaultGuildId || '').trim()
  if (!id) throw new Error('guildId가 필요합니다 (discord_list_guilds로 확인하거나 설정에 기본 서버 ID를 넣으세요).')
  return id
}

function toSnowflake(dateStr) {
  const ms = Date.parse(dateStr)
  if (Number.isNaN(ms)) throw new Error('날짜 형식이 올바르지 않습니다: ' + dateStr)
  return ((BigInt(ms) - DISCORD_EPOCH) << 22n).toString()
}

function cmpId(a, b) { const x = BigInt(a), y = BigInt(b); return x < y ? -1 : x > y ? 1 : 0 }

function fmtTime(iso) { return new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + 'Z' }

function fmtMessage(m, byId) {
  const name = m.member?.nick || m.author?.global_name || m.author?.username || 'unknown'
  let line = `[${fmtTime(m.timestamp)}] ${name}${m.author?.bot ? ' [bot]' : ''}`
  if (m.referenced_message || m.message_reference?.message_id) {
    const ref = m.referenced_message || byId.get(m.message_reference.message_id)
    const refName = ref?.author?.global_name || ref?.author?.username
    line += refName ? ` (↪ ${refName})` : ' (↪ reply)'
  }
  let body = m.content || ''
  for (const u of m.mentions || []) body = body.split(`<@${u.id}>`).join('@' + (u.global_name || u.username)).split(`<@!${u.id}>`).join('@' + (u.global_name || u.username))
  const extras = []
  for (const a of m.attachments || []) extras.push(`[첨부: ${a.filename} ${a.url}]`)
  for (const e of m.embeds || []) { const t = [e.title, e.description].filter(Boolean).join(' - '); if (t) extras.push(`[임베드: ${t.slice(0, 300)}]`) }
  for (const st of m.sticker_items || []) extras.push(`[스티커: ${st.name}]`)
  if (m.thread) extras.push(`[스레드 생성: ${m.thread.name} id=${m.thread.id}]`)
  return `${line}: ${[body, ...extras].filter(Boolean).join(' ')}`
}

async function listGuilds(args, exec) {
  const s = settings()
  const guilds = await api('/users/@me/guilds?limit=200', s.token, exec.signal)
  if (!guilds.length) return text('봇이 참여한 서버가 없습니다. OAuth2 URL로 봇을 서버에 초대하세요.')
  return text(guilds.map(g => `${g.name}  id=${g.id}`).join('\n'))
}

async function listChannels(args, exec) {
  const s = settings()
  const guildId = guildIdOf(args, s)
  const [channels, active] = await Promise.all([
    api(`/guilds/${guildId}/channels`, s.token, exec.signal),
    api(`/guilds/${guildId}/threads/active`, s.token, exec.signal).catch(e => { ctx.log('active threads:', e.message); return { threads: [] } })
  ])
  const all = [...channels, ...(active.threads || [])]
  const cats = new Map(all.filter(c => c.type === 4).map(c => [c.id, c.name]))
  const lines = all
    .filter(c => c.type !== 4)
    .sort((a, b) => (cats.get(a.parent_id) || '').localeCompare(cats.get(b.parent_id) || '') || (a.position ?? 0) - (b.position ?? 0))
    .map(c => {
      const type = CHANNEL_TYPES[c.type] || 'type' + c.type
      const parent = c.type >= 10 && c.type <= 12 ? `thread of ${all.find(p => p.id === c.parent_id)?.name || c.parent_id}` : (cats.get(c.parent_id) || '-')
      return `#${c.name}  id=${c.id}  type=${type}  [${parent}]${READABLE_TYPES.has(c.type) ? '' : '  (메시지 직접 읽기 불가)'}`
    })
  return text(lines.join('\n') || '채널이 없습니다.')
}

async function readMessages(args, exec) {
  const s = settings()
  const channelId = String(args.channelId || '').trim()
  if (!channelId) throw new Error('channelId가 필요합니다.')
  const limit = Math.max(1, Math.min(Number(args.limit) || 200, s.maxMessages))
  const afterId = args.after ? (/^\d+$/.test(String(args.after)) ? String(args.after) : toSnowflake(String(args.after))) : null
  const beforeId = args.before ? (/^\d+$/.test(String(args.before)) ? String(args.before) : toSnowflake(String(args.before))) : null

  const collected = []
  if (afterId) {
    // 오래된 쪽부터 앞으로 페이지 진행
    let cursor = afterId
    while (collected.length < limit) {
      const page = await api(`/channels/${channelId}/messages?limit=100&after=${cursor}`, s.token, exec.signal)
      if (!page.length) break
      page.sort((a, b) => cmpId(a.id, b.id))
      for (const m of page) { if (beforeId && cmpId(m.id, beforeId) >= 0) { cursor = null; break } collected.push(m) }
      if (!cursor || page.length < 100) break
      cursor = page[page.length - 1].id
      exec.update(text(`메시지 ${collected.length}개 수집 중...`))
    }
    collected.splice(limit)
  } else {
    // 최신 쪽부터 뒤로 페이지 진행
    let cursor = beforeId
    while (collected.length < limit) {
      const n = Math.min(100, limit - collected.length)
      const page = await api(`/channels/${channelId}/messages?limit=${n}${cursor ? '&before=' + cursor : ''}`, s.token, exec.signal)
      if (!page.length) break
      collected.push(...page)
      if (page.length < n) break
      cursor = page.reduce((min, m) => (cmpId(m.id, min) < 0 ? m.id : min), page[0].id)
      exec.update(text(`메시지 ${collected.length}개 수집 중...`))
    }
  }

  collected.sort((a, b) => cmpId(a.id, b.id))
  if (!collected.length) return text('해당 범위에 메시지가 없습니다.')
  const byId = new Map(collected.map(m => [m.id, m]))
  const userMsgs = collected.filter(m => !m.author?.bot)
  const emptyContent = userMsgs.length > 0 && userMsgs.every(m => !m.content && !(m.attachments || []).length && !(m.embeds || []).length)
  const header = `채널 ${channelId}: 메시지 ${collected.length}개 (${fmtTime(collected[0].timestamp)} ~ ${fmtTime(collected[collected.length - 1].timestamp)})` +
    `\n가장 오래된 id=${collected[0].id}, 가장 최신 id=${collected[collected.length - 1].id} (이어서 읽으려면 before/after에 사용)` +
    (emptyContent ? '\n⚠ 모든 본문이 비어 있습니다. Developer Portal > Bot 에서 Message Content Intent를 켜세요.' : '')
  return text(header + '\n\n' + collected.map(m => fmtMessage(m, byId)).join('\n'))
}

function wrap(fn) {
  return async (args, exec) => {
    try { return await fn(args || {}, exec) } catch (e) { return text(String(e && e.message || e), true) }
  }
}

exports.activate = (c) => {
  ctx = c
  ctx.channel.handle('testConnection', async (payload) => {
    const token = String(payload?.token || '').trim().replace(/^Bot\s+/i, '')
    if (!token) throw new Error('봇 토큰을 입력하세요.')
    const [me, guilds] = await Promise.all([api('/users/@me', token), api('/users/@me/guilds?limit=200', token)])
    return { bot: me.username, guilds: guilds.map(g => ({ id: g.id, name: g.name })) }
  })
  ctx.registerHostTool({
    definition: { name: 'discord_list_guilds', label: 'Discord 서버 목록', description: '설정된 봇이 참여한 디스코드 서버(guild) 목록과 ID를 반환합니다.', parameters: { type: 'object', properties: {} } },
    execute: wrap(listGuilds)
  })
  ctx.registerHostTool({
    definition: {
      name: 'discord_list_channels', label: 'Discord 채널 목록',
      description: '디스코드 서버의 채널과 활성 스레드 목록(이름, ID, 종류, 카테고리)을 반환합니다. guildId 생략 시 설정의 기본 서버를 사용합니다.',
      parameters: { type: 'object', properties: { guildId: { type: 'string', description: '서버 ID (선택)' } } }
    },
    execute: wrap(listChannels)
  })
  ctx.registerHostTool({
    definition: {
      name: 'discord_read_messages', label: 'Discord 메시지 읽기',
      description: '디스코드 채널/스레드의 메시지를 시간순 텍스트로 가져옵니다(요약·분석용). 기본은 최신 메시지부터 limit개. after/before에는 메시지 ID 또는 ISO 날짜(예: 2026-10-20T00:00:00+09:00)를 넣을 수 있습니다.',
      parameters: {
        type: 'object',
        properties: {
          channelId: { type: 'string', description: '채널 또는 스레드 ID' },
          limit: { type: 'integer', description: '가져올 최대 메시지 수 (기본 200, 설정의 최대값으로 제한)' },
          after: { type: 'string', description: '이 메시지 ID/날짜 이후 메시지만 (오래된 쪽부터 수집)' },
          before: { type: 'string', description: '이 메시지 ID/날짜 이전 메시지만' }
        },
        required: ['channelId']
      }
    },
    execute: wrap(readMessages)
  })
}

exports.deactivate = () => {}
