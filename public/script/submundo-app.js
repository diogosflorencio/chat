// ═══════════════════════════════════════════════════════════════
//  SUBMUNDO — submundo-app.js
//  Supabase-only: Auth · Realtime · Storage · Presence
//  Pure ES Module, no frameworks
// ═══════════════════════════════════════════════════════════════

const { createClient } = window.supabase

// ─────────────────────────────────────────────────────────────
//  Lê do env.js carregado antes deste módulo no HTML
// ─────────────────────────────────────────────────────────────
const SUPABASE_URL = window.__ENV__?.SUPABASE_URL ?? 'https://btvytlopvnhxwxinhvvn.supabase.co'
const SUPABASE_KEY = window.__ENV__?.SUPABASE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dnl0bG9wdm5oeHd4aW5odnZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDA1OTYsImV4cCI6MjA4OTA3NjU5Nn0.bYKXvGRFGPNiiOpHTwkEnTjC2cr6HPS9rj5odm_FBL4'
const BUCKET       = 'submundo'
const MAX_FILE_MB  = 10
const NSFW_THRESH  = 0.70
const GERAL_ID     = '00000000-0000-0000-0000-000000000001'
// ─────────────────────────────────────────────────────────────

const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Estado global ─────────────────────────────────────────────
const S = {
  user:            null,
  profile:         null,
  groups:          [],
  dms:             [],           // [{ id, profile }]
  onlineUsers:     {},           // { user_id: presenceObj }
  currentChat:     null,         // { type:'group'|'dm', id, name }
  pendingFile:     null,         // File | null
  msgChannel:      null,
  presenceChannel: null,
  nsfwModel:       null,
  nsfwLoading:     false,
}

// ── Helpers DOM ───────────────────────────────────────────────
const $  = id => document.getElementById(id)
const mk = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e }

function escapeHTML(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}

function linkify(text) {
  return text.replace(/(https?:\/\/[^\s<>]+)/g,
    '<a class="msg-link" href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
}

function formatBytes(b) {
  if (!b) return ''
  if (b < 1024) return b + ' B'
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB'
  return (b/1048576).toFixed(1) + ' MB'
}

function fmtTime(isoStr) {
  const d = new Date(isoStr)
  return d.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })
}

function fmtDate(isoStr) {
  const d = new Date(isoStr)
  const today     = new Date()
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString())     return 'hoje'
  if (d.toDateString() === yesterday.toDateString()) return 'ontem'
  return d.toLocaleDateString('pt-BR')
}

function randomColor() {
  const c = ['#00c853','#2979ff','#aa00ff','#ff6d00','#d500f9',
             '#00bcd4','#ff5722','#8bc34a','#e91e63','#00b0ff']
  return c[Math.floor(Math.random() * c.length)]
}

let toastTimer = null
function toast(msg, type = '') {
  const el = $('toast')
  el.textContent = msg
  el.className = `show ${type}`
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.className = '' }, 3000)
}

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res()
    const s = document.createElement('script')
    s.src = src; s.onload = res; s.onerror = rej
    document.head.appendChild(s)
  })
}

// ── Noise canvas ──────────────────────────────────────────────
function initNoise() {
  const canvas = $('noise-bg'); if (!canvas) return
  const ctx = canvas.getContext('2d')
  const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight }
  resize(); window.addEventListener('resize', resize)
  let last = 0
  function draw(ts) {
    if (ts - last > 120) {  // ~8fps — suficiente, menos custo
      const { width: w, height: h } = canvas
      const img = ctx.createImageData(w, h)
      const d   = img.data
      for (let i = 0; i < d.length; i += 4) {
        if (Math.random() > 0.992) { d[i+1] = 80; d[i+3] = 35 }
      }
      ctx.putImageData(img, 0, 0)
      last = ts
    }
    requestAnimationFrame(draw)
  }
  requestAnimationFrame(draw)
}

// ═══════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════
async function login(email, password) {
  // Corrige: retorna objeto { error, data } para consumir corretamente no doLogin
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  return { data, error };
}

async function register(username, email, password) {
  // verifica username único
  const { data: ex } = await sb.from('profiles').select('id').eq('username', username).maybeSingle()
  if (ex) return new Error('Username já em uso')
  const { error } = await sb.auth.signUp({
    email, password,
    options: { data: { username, avatar_color: randomColor() } }
  })
  return error
}

async function logout() {
  if (S.presenceChannel) {
    try { await S.presenceChannel.untrack() } catch {}
    sb.removeChannel(S.presenceChannel)
  }
  if (S.msgChannel) sb.removeChannel(S.msgChannel)
  await sb.auth.signOut()
}

// ═══════════════════════════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════════════════════════
async function loadOrCreateProfile() {
  const { data, error } = await sb.from('profiles').select('*').eq('id', S.user.id).maybeSingle()
  if (data) { S.profile = data; return }

  const username = S.user.user_metadata?.username
    || 'user_' + S.user.id.slice(0,6)
  const avatar_color = S.user.user_metadata?.avatar_color || randomColor()

  const { data: created } = await sb.from('profiles')
    .upsert({ id: S.user.id, username, avatar_color })
    .select().single()

  S.profile = created || { id: S.user.id, username, avatar_color }
}

// ═══════════════════════════════════════════════════════════════
//  GRUPOS
// ═══════════════════════════════════════════════════════════════
async function loadGroups() {
  const { data } = await sb.from('groups')
    .select('*').eq('is_public', true).order('created_at')
  S.groups = data || []
  renderGroupsList()

  // auto-join #geral
  const { data: mem } = await sb.from('group_members')
    .select('group_id').eq('group_id', GERAL_ID).eq('user_id', S.user.id).maybeSingle()
  if (!mem) {
    await sb.from('group_members').insert({ group_id: GERAL_ID, user_id: S.user.id })
  }
}

async function createGroup(name, description) {
  const { data, error } = await sb.from('groups').insert({
    name: name.trim(),
    description: description.trim() || null,
    created_by: S.user.id,
    is_public: true,
  }).select().single()
  if (error) return error
  await sb.from('group_members').insert({ group_id: data.id, user_id: S.user.id })
  S.groups.push(data)
  renderGroupsList()
  openGroup(data)
  return null
}

// ═══════════════════════════════════════════════════════════════
//  DMs / CONVERSAS
// ═══════════════════════════════════════════════════════════════
async function loadDMs() {
  const { data } = await sb.from('conversations')
    .select('id, user1_id, user2_id')
    .or(`user1_id.eq.${S.user.id},user2_id.eq.${S.user.id}`)
  if (!data?.length) { S.dms = []; renderDMsList(); return }

  const otherIds = data.map(c => c.user1_id === S.user.id ? c.user2_id : c.user1_id)
  const { data: profiles } = await sb.from('profiles').select('*').in('id', otherIds)
  const pMap = Object.fromEntries((profiles || []).map(p => [p.id, p]))

  S.dms = data.map(c => ({
    id: c.id,
    profile: pMap[c.user1_id === S.user.id ? c.user2_id : c.user1_id] || { id: '?', username: '?' }
  }))
  renderDMsList()
}

async function openOrCreateDM(targetProfile) {
  // procura conversa existente
  const { data: existing } = await sb.from('conversations')
    .select('id')
    .or(
      `and(user1_id.eq.${S.user.id},user2_id.eq.${targetProfile.id}),` +
      `and(user1_id.eq.${targetProfile.id},user2_id.eq.${S.user.id})`
    )
    .maybeSingle()

  let convId = existing?.id
  if (!convId) {
    const { data: nc } = await sb.from('conversations').insert({
      user1_id: S.user.id, user2_id: targetProfile.id
    }).select().single()
    convId = nc.id
    if (!S.dms.find(d => d.id === convId)) {
      S.dms.push({ id: convId, profile: targetProfile })
      renderDMsList()
    }
  }
  S.currentChat = { type: 'dm', id: convId, name: targetProfile.username }
  activateChat()
}

// ═══════════════════════════════════════════════════════════════
//  MENSAGENS
// ═══════════════════════════════════════════════════════════════
async function loadMessages() {
  const area = $('messages-area')
  area.innerHTML = ''
  if (!S.currentChat) return

  const col = S.currentChat.type === 'group' ? 'group_id' : 'conversation_id'
  const { data, error } = await sb
    .from('messages')
    .select('*, sender:profiles!messages_sender_id_fkey(id,username,avatar_color)')
    .eq(col, S.currentChat.id)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })
    .limit(200)

  if (error || !data?.length) {
    const hint = mk('div', 'msg-no-chat')
    hint.innerHTML = `início da conversa em <span>${S.currentChat.name}</span>`
    area.appendChild(hint)
    return
  }

  let lastDate = null
  for (const msg of data) {
    const d = fmtDate(msg.created_at)
    if (d !== lastDate) { area.appendChild(dateDivider(d)); lastDate = d }
    area.appendChild(buildMessageEl(msg))
  }
  scrollBottom()
}

async function sendMessage(content, type = 'text', fileUrl = null, fileName = null, fileSize = null) {
  if (!S.currentChat) return

  const col = S.currentChat.type === 'group' ? 'group_id' : 'conversation_id'
  const { error } = await sb.from('messages').insert({
    sender_id:    S.user.id,
    [col]:        S.currentChat.id,
    content:      content || null,
    type,
    file_url:     fileUrl,
    file_name:    fileName,
    file_size:    fileSize,
  })
  if (error) { toast('Erro ao enviar: ' + error.message, 'error'); console.error(error) }
}

async function deleteMsg(id) {
  if (!confirm('Apagar mensagem?')) return
  await sb.from('messages').update({ is_deleted: true }).eq('id', id).eq('sender_id', S.user.id)
}

// ═══════════════════════════════════════════════════════════════
//  UPLOAD + NSFW
// ═══════════════════════════════════════════════════════════════
async function uploadFile(file) {
  if (file.size > MAX_FILE_MB * 1024 * 1024)
    return { error: `Arquivo muito grande. Máximo: ${MAX_FILE_MB}MB` }

  // NSFW check somente em imagens
  if (file.type.startsWith('image/')) {
    $('upload-label').textContent = 'verificando conteúdo...'
    $('upload-progress').style.display = 'flex'
    const blocked = await checkNSFW(file)
    if (blocked) {
      $('upload-progress').style.display = 'none'
      return { error: '🚫 Conteúdo bloqueado: imagem inapropriada detectada' }
    }
  } else {
    $('upload-label').textContent = 'enviando...'
    $('upload-progress').style.display = 'flex'
  }

  const ext  = file.name.split('.').pop()
  const path = `${S.user.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`

  const { error } = await sb.storage.from(BUCKET).upload(path, file, {
    contentType:  file.type,
    cacheControl: '3600',
    upsert:       false,
  })
  $('upload-progress').style.display = 'none'

  if (error) return { error: error.message }
  const { data: { publicUrl } } = sb.storage.from(BUCKET).getPublicUrl(path)
  return { url: publicUrl, name: file.name, size: file.size }
}

async function checkNSFW(file) {
  try {
    if (!S.nsfwModel && !S.nsfwLoading) {
      S.nsfwLoading = true
      await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js')
      await loadScript('https://cdn.jsdelivr.net/npm/nsfwjs@2.4.2/dist/nsfwjs.min.js')
      S.nsfwModel = await window.nsfwjs.load()
      S.nsfwLoading = false
    }
    // aguarda modelo se ainda carregando
    while (S.nsfwLoading) await new Promise(r => setTimeout(r, 200))
    if (!S.nsfwModel) return false

    const url = URL.createObjectURL(file)
    const img = new Image()
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url })
    const preds = await S.nsfwModel.classify(img)
    URL.revokeObjectURL(url)
    return preds.some(p => ['Porn','Hentai'].includes(p.className) && p.probability > NSFW_THRESH)
  } catch (e) {
    console.warn('NSFW check falhou:', e)
    return false // fail-open
  }
}

// ═══════════════════════════════════════════════════════════════
//  PRESENÇA (online users)
// ═══════════════════════════════════════════════════════════════
function initPresence() {
  if (S.presenceChannel) { sb.removeChannel(S.presenceChannel) }

  S.presenceChannel = sb.channel('submundo:presence', {
    config: { presence: { key: S.user.id } }
  })
  .on('presence', { event: 'sync' }, () => {
    const st = S.presenceChannel.presenceState()
    S.onlineUsers = {}
    Object.values(st).flat().forEach(p => { S.onlineUsers[p.user_id] = p })
    renderOnlineUsers()
    renderDMsList()
    $('online-count').textContent = Object.keys(S.onlineUsers).length
  })
  .subscribe(async status => {
    if (status === 'SUBSCRIBED') {
      await S.presenceChannel.track({
        user_id:      S.profile.id,
        username:     S.profile.username,
        avatar_color: S.profile.avatar_color,
      })
    }
  })
}

// ═══════════════════════════════════════════════════════════════
//  REALTIME — mensagens
// ═══════════════════════════════════════════════════════════════
function subscribeMessages() {
  if (S.msgChannel) { sb.removeChannel(S.msgChannel); S.msgChannel = null }
  if (!S.currentChat) return

  const col    = S.currentChat.type === 'group' ? 'group_id' : 'conversation_id'
  const filter = `${col}=eq.${S.currentChat.id}`

  S.msgChannel = sb.channel(`msgs:${S.currentChat.id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter },
      async payload => {
        const { data } = await sb.from('messages')
          .select('*, sender:profiles!messages_sender_id_fkey(id,username,avatar_color)')
          .eq('id', payload.new.id).maybeSingle()
        if (!data || data.is_deleted) return
        const area = $('messages-area')
        // checar divisor de data
        const today = fmtDate(data.created_at)
        const lastDiv = area.querySelector('.msg-date-divider:last-of-type')
        if (!lastDiv || lastDiv.textContent !== today) area.appendChild(dateDivider(today))
        area.appendChild(buildMessageEl(data))
        scrollBottom()
      })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter },
      payload => {
        if (payload.new.is_deleted) {
          const el = $('messages-area').querySelector(`[data-msg="${payload.new.id}"]`)
          if (el) el.classList.add('deleted')
        }
      })
    .subscribe()
}

// ═══════════════════════════════════════════════════════════════
//  UI — Build elements
// ═══════════════════════════════════════════════════════════════
function buildMessageEl(msg) {
  const isMine = msg.sender_id === S.user.id
  const w      = mk('div', `msg-wrapper ${isMine ? 'mine' : 'theirs'}`)
  w.dataset.msg = msg.id

  const sender = msg.sender || { username: 'anon', avatar_color: '#444' }
  const hora   = fmtTime(msg.created_at)
  const color  = sender.avatar_color || '#444'
  const letter = (sender.username || '?').charAt(0).toUpperCase()

  // avatar
  const av = mk('div', 'msg-avatar')
  av.style.background = color
  av.textContent = letter

  // bubble
  const bubble = mk('div', 'msg-bubble')

  if (!isMine) {
    const sn = mk('span', 'msg-sender')
    sn.textContent = sender.username
    sn.style.color = color
    bubble.appendChild(sn)
  }

  // conteúdo
  const content = mk('div', 'msg-content')
  if (msg.type === 'image') {
    const img = mk('img', 'msg-image')
    img.src = msg.file_url
    img.alt = msg.file_name || 'imagem'
    img.loading = 'lazy'
    img.addEventListener('click', () => openImageModal(msg.file_url))
    content.appendChild(img)
  } else if (msg.type === 'audio') {
    const audio = mk('audio', 'msg-audio')
    audio.src = msg.file_url; audio.controls = true
    content.appendChild(audio)
  } else if (msg.type === 'file') {
    const a = mk('a', 'msg-file')
    a.href = msg.file_url; a.target = '_blank'; a.rel = 'noopener'
    a.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <span>${escapeHTML(msg.file_name || 'arquivo')}</span>
      <small>${formatBytes(msg.file_size)}</small>
    `
    content.appendChild(a)
  } else {
    const span = mk('span', 'msg-text')
    span.innerHTML = linkify(escapeHTML(msg.content || ''))
    content.appendChild(span)
  }
  bubble.appendChild(content)

  // footer: hora + apagar
  const footer = mk('div', 'msg-footer')
  const timeEl = mk('span', 'msg-time')
  timeEl.textContent = hora
  footer.appendChild(timeEl)

  if (isMine) {
    const del = mk('button', 'msg-delete')
    del.textContent = '✕'; del.title = 'Apagar'
    del.addEventListener('click', e => { e.stopPropagation(); deleteMsg(msg.id) })
    footer.appendChild(del)
  }
  bubble.appendChild(footer)

  if (isMine) { w.appendChild(bubble); w.appendChild(av) }
  else        { w.appendChild(av);     w.appendChild(bubble) }
  return w
}

function dateDivider(label) {
  const d = mk('div', 'msg-date-divider')
  d.textContent = label; return d
}

// ── Listas sidebar ────────────────────────────────────────────
function renderGroupsList() {
  const list = $('list-groups'); list.innerHTML = ''
  S.groups.forEach(g => {
    const li = mk('li', `chat-item${S.currentChat?.id === g.id ? ' active' : ''}`)
    li.innerHTML = `<span class="chat-hash">#</span>${escapeHTML(g.name)}`
    if (g.description) li.title = g.description
    li.addEventListener('click', () => openGroup(g))
    list.appendChild(li)
  })
}

function renderDMsList() {
  const list = $('list-dms'); list.innerHTML = ''
  if (!S.dms.length) {
    const li = mk('li', 'sidebar-hint'); li.textContent = 'clique em um usuário online →'
    list.appendChild(li); return
  }
  S.dms.forEach(dm => {
    const online = !!S.onlineUsers[dm.profile.id]
    const li = mk('li', `chat-item${S.currentChat?.id === dm.id ? ' active' : ''}`)
    li.innerHTML = `
      <span class="dm-dot" style="background:${online ? 'var(--verde)' : 'var(--text-3)'}"></span>
      <span>@${escapeHTML(dm.profile.username)}</span>
    `
    li.addEventListener('click', () => openOrCreateDM(dm.profile))
    list.appendChild(li)
  })
}

function renderOnlineUsers() {
  const list = $('list-online'); list.innerHTML = ''
  const users = Object.values(S.onlineUsers)
  if (!users.length) {
    const li = mk('li', 'online-empty'); li.textContent = 'só você aqui'
    list.appendChild(li); return
  }
  users.forEach(u => {
    const isSelf = u.user_id === S.user.id
    const li = mk('li', `online-user${isSelf ? ' online-self' : ''}`)
    const av = mk('div', 'online-avatar')
    av.style.background = u.avatar_color || '#444'
    av.textContent = (u.username || '?').charAt(0).toUpperCase()
    const name = mk('span')
    name.textContent = `@${u.username}${isSelf ? ' (você)' : ''}`
    li.appendChild(av); li.appendChild(name)
    if (!isSelf) {
      li.title = `Abrir DM com ${u.username}`
      li.addEventListener('click', () => openOrCreateDM({
        id: u.user_id, username: u.username, avatar_color: u.avatar_color
      }))
    }
    list.appendChild(li)
  })
}

// ── Navegação de chat ─────────────────────────────────────────
function openGroup(g) {
  S.currentChat = { type: 'group', id: g.id, name: g.name }
  activateChat()
}

function activateChat() {
  const isGroup = S.currentChat.type === 'group'
  $('topbar-chat-icon').textContent = isGroup ? '#' : '@'
  $('topbar-chat-name').textContent = S.currentChat.name
  renderGroupsList()
  renderDMsList()
  loadMessages()
  subscribeMessages()
}

// ── Abrir/fechar app ──────────────────────────────────────────
function showAuthScreen() {
  $('auth-screen').style.display = 'flex'
  $('app').style.display = 'none'
}

async function showApp() {
  $('auth-screen').style.display = 'none'
  $('app').style.display = 'flex'

  // avatar no topbar
  const av = $('topbar-user-avatar')
  av.style.background = S.profile.avatar_color
  av.textContent = S.profile.username.charAt(0).toUpperCase()
  $('topbar-user').textContent = `@${S.profile.username}`

  await loadGroups()
  await loadDMs()
  initPresence()

  // mensagem de boas-vindas no chat principal
  const geral = S.groups.find(g => g.id === GERAL_ID) || S.groups[0]
  if (geral) openGroup(geral)
  else {
    const area = $('messages-area')
    const hint = mk('div', 'msg-no-chat')
    hint.innerHTML = 'bem-vindo ao <span>submundo</span>. crie ou selecione um canal.'
    area.appendChild(hint)
  }
}

// ── Modal de imagem ───────────────────────────────────────────
function openImageModal(src) {
  $('image-modal-img').src   = src
  $('image-modal-download').href = src
  $('image-modal').style.display = 'flex'
}
function closeImageModal() {
  $('image-modal').style.display = 'none'
  $('image-modal-img').src = ''
}

// ── Scroll ────────────────────────────────────────────────────
function scrollBottom() {
  const a = $('messages-area')
  a.scrollTop = a.scrollHeight
}

// ═══════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════
function initEvents() {

  // ── Auth tabs
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'))
      document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'))
      tab.classList.add('active')
      const activeForm = $(`tab-${tab.dataset.tab}`)
      if (activeForm) activeForm.classList.add('active')
    })
  })

  // ── Login
  async function doLogin() {
    const emailEl = $('login-email')
    const passEl = $('login-password')
    const errEl  = $('login-error')
    if (!emailEl || !passEl || !errEl) return
    const email = emailEl.value ? emailEl.value.trim() : ''
    const pw    = passEl.value ?? ''
    errEl.textContent = ''
    if (!email || !pw) { errEl.textContent = 'Preencha todos os campos'; return }
    const btnLoginTxt = $('btn-login-txt')
    const btnLogin    = $('btn-login')
    if (btnLoginTxt) btnLoginTxt.textContent = '⟳ identificando...'
    if (btnLogin) btnLogin.disabled = true

    try {
      // Corrigido: trata a resposta retornando { data, error }
      const { error } = await login(email, pw)
      if (btnLogin) btnLogin.disabled = false
      if (btnLoginTxt) btnLoginTxt.textContent = '► ENTRAR'
      if (error) errEl.textContent = error.message
    } catch (err) {
      if (btnLogin) btnLogin.disabled = false
      if (btnLoginTxt) btnLoginTxt.textContent = '► ENTRAR'
      errEl.textContent = 'Erro de login. Tente novamente.'
    }
  }

  const btnLogin = $('btn-login')
  if (btnLogin) btnLogin.addEventListener('click', doLogin)

  const loginEmail = $('login-email')
  if (loginEmail) {
    loginEmail.addEventListener('keydown', e => {
      if (e.key === 'Enter') doLogin()
    })
  }

  const loginPass = $('login-password')
  if (loginPass) {
    loginPass.addEventListener('keydown', e => {
      if (e.key === 'Enter') doLogin()
    })
  }

  // ── Register
  async function doRegister() {
    const regUsernameEl = $('reg-username')
    const regEmailEl    = $('reg-email')
    const regPassEl     = $('reg-password')
    const errEl         = $('register-error')
    const okEl          = $('register-ok')
    if (!regUsernameEl || !regEmailEl || !regPassEl || !errEl || !okEl) return

    const username = regUsernameEl.value.trim().replace(/^@/, '')
    const email    = regEmailEl.value.trim()
    const pw       = regPassEl.value
    errEl.textContent = ''; okEl.style.display = 'none'

    if (!username || !email || !pw) { errEl.textContent = 'Preencha todos os campos'; return }
    if (username.length < 3)        { errEl.textContent = 'Username: mínimo 3 caracteres'; return }
    if (!/^[a-z0-9_]+$/i.test(username)) { errEl.textContent = 'Username: só letras, números e _'; return }
    if (pw.length < 6)              { errEl.textContent = 'Senha: mínimo 6 caracteres'; return }

    const btnRegisterTxt = $('btn-register-txt')
    const btnRegister    = $('btn-register')
    if (btnRegisterTxt) btnRegisterTxt.textContent = '⟳ criando...'
    if (btnRegister) btnRegister.disabled = true
    const error = await register(username, email, pw)
    if (btnRegister) btnRegister.disabled = false
    if (btnRegisterTxt) btnRegisterTxt.textContent = '► CRIAR CONTA'

    if (error) { errEl.textContent = error.message }
    else       { okEl.style.display = 'block' }
  }
  const btnRegister = $('btn-register')
  if (btnRegister) btnRegister.addEventListener('click', doRegister)
  const regUsername = $('reg-username')
  if (regUsername) regUsername.addEventListener('keydown', e => { if (e.key === 'Enter') doRegister() })
  const regEmail = $('reg-email')
  if (regEmail) regEmail.addEventListener('keydown', e => { if (e.key === 'Enter') doRegister() })
  const regPass = $('reg-password')
  if (regPass) regPass.addEventListener('keydown', e => { if (e.key === 'Enter') doRegister() })

  // ── Logout
  $('btn-logout')?.addEventListener('click', logout)

  // ── Send message (form submit)
  $('input-bar')?.addEventListener('submit', async e => {
    e.preventDefault()
    if (!S.currentChat) { toast('Selecione um canal primeiro', 'error'); return }
    const text  = $('message-input').value.trim()
    const file  = S.pendingFile

    if (!file && !text) return

    $('btn-send').disabled = true

    if (file) {
      S.pendingFile = null
      $('file-preview').style.display = 'none'

      const result = await uploadFile(file)
      if (result.error) { toast(result.error, 'error'); $('btn-send').disabled = false; return }

      const type = file.type.startsWith('image/') ? 'image'
        : file.type.startsWith('audio/')          ? 'audio'
        : 'file'
      await sendMessage(text || null, type, result.url, result.name, result.size)
    } else {
      await sendMessage(text)
    }

    $('message-input').value = ''
    $('btn-send').disabled = false
    $('message-input').focus()
  })

  // ── File input
  $('file-input')?.addEventListener('change', e => {
    const file = e.target.files[0]
    $('file-input').value = ''
    if (!file) return

    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast(`Arquivo muito grande (máx ${MAX_FILE_MB}MB)`, 'error'); return
    }

    S.pendingFile = file
    const thumbEl = $('file-preview-thumb')
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      const img = mk('img'); img.src = url; img.onload = () => URL.revokeObjectURL(url)
      thumbEl.innerHTML = ''; thumbEl.appendChild(img)
    } else {
      thumbEl.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>`
      thumbEl.style.display = 'flex'
      thumbEl.style.alignItems = 'center'
      thumbEl.style.justifyContent = 'center'
      thumbEl.style.color = 'var(--verde-mid)'
    }
    $('file-preview-name').textContent = file.name
    $('file-preview').style.display = 'flex'
  })
  $('btn-cancel-file')?.addEventListener('click', () => {
    S.pendingFile = null
    $('file-preview').style.display = 'none'
  })

  // ── Criar grupo
  $('btn-create-group')?.addEventListener('click', () => {
    $('group-modal').style.display = 'flex'
    setTimeout(() => $('group-name-input').focus(), 50)
  })
  $('btn-cancel-group')?.addEventListener('click', () => {
    $('group-modal').style.display = 'none'
  })
  $('btn-confirm-group')?.addEventListener('click', async () => {
    const groupNameEl = $('group-name-input')
    const groupDescEl = $('group-desc-input')
    const groupErrEl  = $('group-error')
    const btnConfirmGroup = $('btn-confirm-group')
    if (!groupNameEl || !groupDescEl || !groupErrEl || !btnConfirmGroup) return
    const name = groupNameEl.value.trim()
    if (!name) { groupErrEl.textContent = 'Nome é obrigatório'; return }
    btnConfirmGroup.disabled = true
    const error = await createGroup(name, groupDescEl.value)
    btnConfirmGroup.disabled = false
    if (error) { groupErrEl.textContent = error.message; return }
    $('group-modal').style.display = 'none'
    groupNameEl.value = ''
    groupDescEl.value = ''
    groupErrEl.textContent = ''
  })
  const groupNameInput = $('group-name-input')
  if (groupNameInput) groupNameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btn-confirm-group')?.click()
  })

  // ── Modal imagem
  $('image-modal')?.addEventListener('click', e => {
    if (e.target === $('image-modal')) closeImageModal()
  })
  $('image-modal-close')?.addEventListener('click', closeImageModal)

  // ── Teclas globais
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeImageModal()
      $('group-modal').style.display = 'none'
    }
  })
}


// ═══════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════
async function init() {
  initNoise()
  initEvents()

  // verifica sessão existente
  const { data: { session } } = await sb.auth.getSession()
  if (session) {
    S.user = session.user
    await loadOrCreateProfile()
    await showApp()
  } else {
    showAuthScreen()
  }

  // escuta mudanças de auth
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      S.user = session.user
      await loadOrCreateProfile()
      await showApp()
    } else if (event === 'SIGNED_OUT') {
      S.user = null; S.profile = null
      S.currentChat = null; S.groups = []; S.dms = []
      showAuthScreen()
    }
  })
}

init()