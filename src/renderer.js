import {
  joinRoom,
  getRelaySockets,
  pauseRelayReconnection,
  resumeRelayReconnection,
} from '@trystero-p2p/torrent'

// Wipe any storage that a prior session or dependency may have written
localStorage.clear()
sessionStorage.clear()

// ── name generator ──────────────────────────────────────────────
// Generates a fresh "AdjectiveNoun#1234" identity on every launch.
// _usedNicks guards against repeats within a single session.
const ADJECTIVES = [
  'Hollow',    'Wretched',   'Gilded',      'Forlorn',    'Spectral',
  'Vagrant',   'Wayward',    'Cursed',      'Feral',      'Lovelorn',
  'Mournful',  'Wistful',    'Errant',      'Pallid',     'Ashen',
  'Eldritch',  'Ruinous',    'Twilit',      'Gossamer',   'Dire',
  'Arcane',    'Somber',     'Verdant',     'Crimson',    'Silvered',
  'Haunted',   'Blighted',   'Ethereal',    'Moonlit',    'Frosted',
  'Withered',  'Sunken',     'Drifting',    'Liminal',    'Riven',
  'Ghastly',   'Brooding',   'Veiled',      'Shrouded',   'Stricken',
  'Roaming',   'Forsaken',   'Unbound',     'Savage',     'Desolate',
  'Harrowed',  'Lonesome',   'Doleful',     'Pensive',    'Gaunt',
  'Bereft',    'Nocturnal',  'Ancient',     'Sundered',   'Windswept',
  'Accursed',  'Misty',      'Wolven',      'Tattered',   'Sodden',
  'Ominous',   'Tenebrous',  'Sepulchral',  'Sullen',     'Moribund',
  'Lachrymose','Phantasmal', 'Charnel',     'Dolorous',   'Fugitive',
  'Crepuscular','Sable',     'Vesper',      'Lurid',      'Waning',
  'Aureate',   'Sunless',    'Haggard',     'Obscure',    'Brambled',
  'Thistled',  'Dreaming',   'Wandering',   'Iron',       'Drowned',
  'Baleful',   'Tempestuous','Benighted',   'Cloven',     'Shriven',
]

const NOUNS = [
  'Specter',    'Wraith',     'Mariner',    'Raven',      'Basilisk',
  'Revenant',   'Changeling', 'Wyrm',       'Shade',      'Pilgrim',
  'Vagrant',    'Heron',      'Chimera',    'Gargoyle',   'Wyvern',
  'Moth',       'Serpent',    'Harbinger',  'Wanderer',   'Phantom',
  'Oracle',     'Sphinx',     'Banshee',    'Griffin',    'Siren',
  'Dryad',      'Urchin',     'Prowler',    'Hermit',     'Wayfarer',
  'Corsair',    'Crow',       'Jackal',     'Stag',       'Osprey',
  'Falcon',     'Lynx',       'Badger',     'Crane',      'Stoat',
  'Viper',      'Rook',       'Wren',       'Goblin',     'Templar',
  'Fox',        'Selkie',     'Kelpie',     'Peregrine',  'Cormorant',
  'Curlew',     'Nightjar',   'Merlin',     'Minstrel',   'Knave',
  'Thane',      'Waif',       'Exile',      'Ferryman',   'Rake',
  'Sailor',     'Shepherd',   'Widow',      'Crone',      'Warlock',
  'Adder',      'Kestrel',    'Harrier',    'Nighthawk',  'Herald',
  'Wight',      'Boggart',    'Barrow',     'Hallow',     'Briar',
  'Thorn',      'Hemlock',    'Nightshade', 'Gallowglass','Galleon',
  'Pyre',       'Lantern',    'Mantis',     'Fetch',      'Nixie',
  'Strix',      'Caitiff',    'Anchorite',  'Grackle',    'Thistle',
]

const _usedNicks = new Set()
function randomName() {
  let name
  do {
    const adj  = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
    const num  = Math.floor(Math.random() * 9000) + 1000
    name = `${adj}${noun}#${num}`
  } while (_usedNicks.has(name))
  _usedNicks.add(name)
  return name
}

function randomHex(n) {
  let s = ''
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

// ── state ────────────────────────────────────────────────────────
const MY_NICK  = randomName()
const APP_ID   = 'narciso-v0'
const LOBBY_ID = 'narciso-v0-lobby'

// Shared RTCPeerConnection config — passed to every joinRoom call.
//
// Nesting under `config` is intentional: Trystero uses @thaunknown/simple-peer,
// which reads opts.config (not top-level iceServers) and passes it to
// RTCPeerConnection via Object.assign({}, Peer.config, opts.config).
// Top-level iceServers in the Peer options are silently ignored.
// Peer.config hardcodes Twilio — we must override it here to suppress those
// DNS failures when a VPN intercepts resolution.
const ROOM_CONFIG = {
  appId: APP_ID,
  // Reconnection to BitTorrent trackers is managed manually so the VPN kill
  // switch can pause it (see triggerVpnKillSwitch / startVpnMonitor) and
  // prevent Trystero from reconnecting to trackers through an exposed
  // interface while the VPN is down.
  relayConfig: {
    manualReconnection: true,
  },
  rtcConfig: {
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302'  },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
      ],
      iceCandidatePoolSize: 0,
      sdpSemantics: 'unified-plan',
    },
  },
}

// Active Trystero room (group room, private match, or abscond room) and its
// chat send function. Only one of `room`/`lobbyRoom` is meaningfully active
// at a time depending on the current mode (room / random / matched).
let room      = null
let sendMsg   = null
let peerNicks = {}

// random-matching (lobby) state
let lobbyRoom       = null
let isMatching      = false
let proposedTo      = null
let proposedRoom    = null
let matchTimeout    = null
let largeRoomWarned = false

// In-memory block list: peers we've already chatted with this session
// (prevents immediate re-match after Next); cleared when app closes
const blockedPeers = new Set()

// abscond state — all reset on room leave/disconnect
let abscondAction    = null   // request-kind action: { request, onRequest }
let abscondingTo     = null   // peerId we're awaiting a reply from
const abscondBlocked = new Set() // peerIds blocked from absconding this session
let incomingAbscondEl    = null // the pending abscond prompt DOM element (if any)
let incomingAbscondTimer = null // auto-dismiss timer for the incoming prompt
let currentRoomId    = null   // current group room name (for origin tracking)
let isAbscondedRoom  = false  // true when inside a private abscond room
let activeRoomPassword = null // password for the currently-joined named room, if any
let abscondOriginRoom = null  // name of the group room we came from

// true once we've connected to at least one peer in the current room — used
// to decide whether the "no response from anyone yet" timeout message
// applies to a password-protected join (see joinRoomNamed).
let hasHadPeerJoinThisRoom = false

// tracker health state
let trackerPollTimer = null
let trackerStatus    = 'unknown' // 'unknown' | 'ok' | 'warn' | 'down'

// settings state
let selectedInterface = 'auto'
let vpnProtectionOn   = false
let vpnBlocked        = false   // true when kill-switch has fired
let vpnPollTimer      = null
let cachedIfaces      = {}      // refreshed via IPC; read synchronously everywhere
let selectedMicId     = 'default'
let selectedCamId     = 'default'

// local media
let localAudioStream = null
let localVideoStream = null
let micOn  = false
let camOn  = false
let hearOn = false
let seeOn  = false
let fileAcceptOn = false
let sendMediaState = null
let sendFile = null // (blob, opts) => Promise — set by setupMediaHandlers

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
const THUMBNAIL_WIDTH = 100
const receivingTransfers = {} // `${peerId}:${transferId}` → { el, progressEl, thumbEl } for in-progress incoming files

// per-peer AV state
const peerStreams   = {}  // peerId → { audio?: MediaStream, video?: MediaStream }
const peerMediaState = {} // peerId → { mic: bool, cam: bool } (from media-state broadcasts)
const peerElements  = {}  // peerId → { box, videoEl, placeholder, label, camBadge, audioEl, btnEar, btnEye, btnAbscond }
const peerAnalysers = {}  // peerId → { ctx, data, animId }
const peerMuted     = {}  // peerId → bool (individual audio mute, overridden by global EAR off)
const peerHidden    = {}  // peerId → bool (individual video hide, overridden by global EYE off)
const peerPingTimers = {} // peerId → interval ID for the 5s ping loop
const peerPingFails  = {} // peerId → consecutive ping failure count

// targeted streaming — what each peer wants from us, and who we're
// currently sending each of our tracks to
const peerWants      = {} // peerId → { audio: bool, video: bool } (what they want to receive from us)
const sendingAudioTo = new Set() // peerIds we're currently addTrack'd to with our mic
const sendingVideoTo = new Set() // peerIds we're currently addTrack'd to with our cam
let sendMediaWant = null // (data, opts) => void — set by setupMediaHandlers

// ── DOM refs ─────────────────────────────────────────────────────
const $msgs       = document.getElementById('messages')
const $input      = document.getElementById('msg-input')
const $send       = document.getElementById('btn-send')
const $join       = document.getElementById('btn-join')
const $copy       = document.getElementById('btn-copy')
const $leave      = document.getElementById('btn-leave')
const $return     = document.getElementById('btn-return')
const $random     = document.getElementById('btn-random')
const $next       = document.getElementById('btn-next')
const $stop       = document.getElementById('btn-stop')
const $roomInput  = document.getElementById('room-input')
const $roomPass   = document.getElementById('room-pass')
const $roomLock   = document.getElementById('room-lock')
const $status     = document.getElementById('status-pill')
const $nPeers     = document.getElementById('n-peers')
const $nickDisp   = document.getElementById('nick-display')
const $peerStatus = document.getElementById('peer-media-status')

const $btnMic  = document.getElementById('btn-mic')
const $btnCam  = document.getElementById('btn-cam')
const $btnEar  = document.getElementById('btn-ear')
const $btnEye  = document.getElementById('btn-eye')
const $btnFile = document.getElementById('btn-file')

const $btnAttach = document.getElementById('btn-attach')
const $fileInput = document.getElementById('file-input')
const $dropZone  = document.getElementById('file-drop-zone')

const $peerPills     = document.getElementById('peer-pills')
const $videoArea     = document.getElementById('video-area')
const $videoGrid     = document.getElementById('video-grid')
const $audioOverflow = document.getElementById('audio-overflow')
const $selfPreview   = document.getElementById('self-preview')

const $btnSettings      = document.getElementById('btn-settings')
const $settingsPanel    = document.getElementById('settings-panel')
const $btnSettingsClose = document.getElementById('btn-settings-close')
const $ifaceSelect      = document.getElementById('iface-select')
const $ifaceInfo        = document.getElementById('iface-info')
const $btnVpn           = document.getElementById('btn-vpn')
const $vpnIndicator     = document.getElementById('vpn-indicator')
const $trackerIndicator = document.getElementById('tracker-indicator')
const $micSelect        = document.getElementById('mic-select')
const $camSelect        = document.getElementById('cam-select')

$nickDisp.textContent = MY_NICK

// ── helpers ──────────────────────────────────────────────────────
// Small DOM/text utilities used by the chat log and elsewhere.
function ts() {
  const d = new Date()
  return `[${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}]`
}

function sysMsg(text) {
  const el = document.createElement('div')
  el.className = 'msg system'
  el.innerHTML = `<span class="ts">${ts()}</span><span class="sym">›</span>${escHtml(text)}`
  $msgs.appendChild(el)
  $msgs.scrollTop = $msgs.scrollHeight
}

function chatMsg(nick, body, isSelf) {
  const el = document.createElement('div')
  el.className = 'msg'
  el.innerHTML = `<span class="ts">${ts()}</span><span class="nick ${isSelf ? 'self' : 'peer'}">${escHtml(nick)}</span><span class="body">${escHtml(body)}</span>`
  $msgs.appendChild(el)
  $msgs.scrollTop = $msgs.scrollHeight
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function clearMessages() { $msgs.innerHTML = ''; incomingAbscondEl = null }

function updatePeerCount() {
  $nPeers.textContent = Object.keys(peerNicks).length
  updatePeerPills()
}

// ── peer pills strip ─────────────────────────────────────────────
// Always-visible compact list of who's in the room, shown only for group
// rooms with 3+ people (including us). Lets you ABSCOND even when nobody's
// video tiles are showing (no cameras, EYE off).

function updatePeerPills() {
  const inGroupRoom = document.body.classList.contains('group-room')
  const peerIds = Object.keys(peerNicks)

  if (!inGroupRoom || peerIds.length < 2) {
    $peerPills.style.display = 'none'
    $peerPills.innerHTML = ''
    return
  }

  $peerPills.style.display = 'flex'
  $peerPills.innerHTML = ''
  for (const peerId of peerIds) {
    const nick = peerNicks[peerId] || peerId.slice(0, 8) + '…'

    const pill = document.createElement('div')
    pill.className = 'peer-pill'

    const nameSpan = document.createElement('span')
    nameSpan.className = 'peer-pill-name'
    nameSpan.textContent = nick
    pill.appendChild(nameSpan)

    const btnAbscond = document.createElement('button')
    btnAbscond.className = 'peer-pill-abscond'
    btnAbscond.textContent = 'ABSCOND'
    btnAbscond.title = 'Request a private room with this peer'
    btnAbscond.addEventListener('click', e => { e.stopPropagation(); requestAbscond(peerId) })
    pill.appendChild(btnAbscond)

    $peerPills.appendChild(pill)
  }
}

// ── media button helpers ─────────────────────────────────────────
// Reflects local MIC/CAM/EAR/EYE state into the toolbar, and lays out the
// video grid (including the audio-only overflow row for 13+ peer rooms).

function updateMediaButtons() {
  const set = (btn, label, active) => {
    btn.textContent = label
    btn.className   = 'media-btn' + (active ? ' on' : '')
  }
  set($btnMic, 'MIC', micOn)
  set($btnCam, 'CAM', camOn)
  set($btnEar, 'EAR', hearOn)
  set($btnEye, 'EYE', seeOn)
  set($btnFile, 'FILE', fileAcceptOn)
}

function updateVideoArea() {
  const hasPeers = Object.keys(peerElements).length > 0
  // Always show the video area when there are peers — even with no cameras
  // and EYE off, peers still get a placeholder tile with their nickname and
  // a CAM badge if their camera is on.
  const show = camOn || hasPeers
  if (!show) { $videoArea.style.display = 'none'; return }
  $videoArea.style.display = 'block'
  $selfPreview.style.display = camOn ? 'block' : 'none'
  // When only self-preview is showing (no peer tiles), ensure the container
  // has enough height to contain the preview element
  if (!hasPeers) $videoArea.style.height = '110px'
}

// Cap on simultaneously rendered video tiles; rooms beyond this size show
// the extra peers as audio-only rows below the grid (see #audio-overflow).
const MAX_VIDEO_TILES = 12

function updateGridLayout() {
  const allPeers = Object.keys(peerElements)
  const n = allPeers.length
  if (n === 0) {
    $audioOverflow.style.display = 'none'
    updateVideoArea()
    return
  }

  // Prioritise peers with active video streams in the video grid slots
  const withVideo    = allPeers.filter(id => peerStreams[id]?.video)
  const withoutVideo = allPeers.filter(id => !peerStreams[id]?.video)
  const sorted = [...withVideo, ...withoutVideo]

  const videoIds = sorted.slice(0, MAX_VIDEO_TILES)
  const audioIds = sorted.slice(MAX_VIDEO_TILES)

  // Move boxes to the correct container and apply/remove audio-only mode
  videoIds.forEach(id => {
    const els = peerElements[id]
    if (!els) return
    els.box.classList.remove('audio-only-tile')
    els.btnEye.style.display = ''
    $videoGrid.appendChild(els.box)
  })
  audioIds.forEach(id => {
    const els = peerElements[id]
    if (!els) return
    els.box.classList.add('audio-only-tile')
    els.btnEye.style.display = 'none'
    $audioOverflow.appendChild(els.box)
  })

  $audioOverflow.style.display = audioIds.length > 0 ? 'flex' : 'none'

  const vis  = videoIds.length
  const cols = vis <= 2 ? vis : vis <= 3 ? 3 : vis <= 4 ? 4 : vis <= 9 ? 3 : 4
  $videoGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`
  $videoGrid.style.gridTemplateRows    = ''

  // Cap the video area's height so it can never push the chat input off
  // screen — if the natural grid height exceeds the cap, clip it and let it
  // scroll internally instead of growing the container.
  const tileH    = Math.round(window.innerWidth / cols * 9 / 16)
  const rows     = Math.ceil(vis / cols)
  const maxH     = Math.round(window.innerHeight * 0.42)
  const naturalH = rows * tileH

  if (naturalH > maxH) {
    $videoArea.style.overflowY = 'auto'
    $videoArea.style.height    = `${maxH}px`
  } else {
    $videoArea.style.overflowY = 'hidden'
    $videoArea.style.height    = `${naturalH}px`
  }

  updateVideoArea()
}

function broadcastMediaState() {
  if (sendMediaState) sendMediaState({ mic: micOn, cam: camOn, file: fileAcceptOn })
}

// ── targeted streaming ───────────────────────────────────────────
// What we want to receive FROM a given peer, based on the global EAR/EYE
// toggles and any per-peer overrides. Sent to peers via the 'media-req'
// action so they only addTrack to us when we actually want their media.

function wantAudioFrom(peerId) {
  return hearOn && !peerMuted[peerId]
}

function wantVideoFrom(peerId) {
  return seeOn && !peerHidden[peerId]
}

function sendMediaWantTo(peerId) {
  if (sendMediaWant) sendMediaWant({ audio: wantAudioFrom(peerId), video: wantVideoFrom(peerId) }, { target: peerId })
}

function sendMediaWantAll() {
  for (const peerId of Object.keys(peerElements)) sendMediaWantTo(peerId)
}

// ── peer video box lifecycle ─────────────────────────────────────
// Creates/destroys the DOM tile for each connected peer (video element,
// nick label, and per-peer EAR/EYE/ABSCOND controls).

function createPeerBox(peerId) {
  if (peerElements[peerId]) return
  const nick = peerNicks[peerId] || peerId.slice(0, 8) + '…'

  const box = document.createElement('div')
  box.className = 'peer-video-box'
  box.dataset.peerId = peerId

  const videoEl = document.createElement('video')
  videoEl.autoplay = true
  videoEl.playsInline = true

  const placeholder = document.createElement('div')
  placeholder.className = 'peer-placeholder'
  placeholder.textContent = nick

  const label = document.createElement('div')
  label.className = 'peer-label'
  label.textContent = nick

  const camBadge = document.createElement('div')
  camBadge.className = 'peer-cam-badge'
  camBadge.textContent = 'CAM'

  const fileBadge = document.createElement('div')
  fileBadge.className = 'peer-file-badge'
  fileBadge.textContent = 'FILE'

  const latencyEl = document.createElement('div')
  latencyEl.className = 'peer-latency'
  latencyEl.textContent = '—'

  // per-tile controls (visible on hover)
  const controls = document.createElement('div')
  controls.className = 'peer-controls'

  const btnEar = document.createElement('button')
  btnEar.className = 'peer-ctrl-btn'
  btnEar.textContent = 'EAR'
  btnEar.title = 'Mute audio from this peer'
  btnEar.addEventListener('click', e => { e.stopPropagation(); togglePeerAudio(peerId) })

  const btnEye = document.createElement('button')
  btnEye.className = 'peer-ctrl-btn'
  btnEye.textContent = 'EYE'
  btnEye.title = 'Hide video from this peer'
  btnEye.addEventListener('click', e => { e.stopPropagation(); togglePeerVideo(peerId) })

  const btnAbscond = document.createElement('button')
  btnAbscond.className = 'peer-ctrl-btn abscond-btn'
  btnAbscond.textContent = 'ABSCOND'
  btnAbscond.title = 'Request a private room with this peer'
  btnAbscond.addEventListener('click', e => { e.stopPropagation(); requestAbscond(peerId) })

  controls.appendChild(btnEar)
  controls.appendChild(btnEye)
  controls.appendChild(btnAbscond)

  box.appendChild(videoEl)
  box.appendChild(placeholder)
  box.appendChild(camBadge)
  box.appendChild(fileBadge)
  box.appendChild(label)
  box.appendChild(latencyEl)
  box.appendChild(controls)
  $videoGrid.appendChild(box)

  const audioEl = new Audio()
  audioEl.autoplay = true

  peerElements[peerId] = { box, videoEl, placeholder, label, camBadge, fileBadge, latencyEl, audioEl, btnEar, btnEye, btnAbscond }
  if (!peerStreams[peerId]) peerStreams[peerId] = {}
  updatePeerCamBadge(peerId)
}

function removePeerBox(peerId) {
  teardownSpeakerDetection(peerId)
  stopPeerPing(peerId)
  const els = peerElements[peerId]
  if (els) {
    els.audioEl.srcObject = null
    els.audioEl.pause()
    els.box.remove()
    delete peerElements[peerId]
  }
  delete peerStreams[peerId]
  delete peerMuted[peerId]
  delete peerHidden[peerId]
  delete peerMediaState[peerId]
}

function attachPeerVideo(peerId, stream) {
  const els = peerElements[peerId]
  if (!els) return
  els.videoEl.srcObject = stream
  els.videoEl.classList.add('has-stream')
  els.placeholder.classList.add('hidden')
  els.videoEl.play().catch(() => {})
  updateVideoArea()
}

function detachPeerVideo(peerId) {
  const els = peerElements[peerId]
  if (!els) return
  els.videoEl.srcObject = null
  els.videoEl.classList.remove('has-stream')
  els.placeholder.classList.remove('hidden')
}

function attachPeerAudio(peerId, stream) {
  const els = peerElements[peerId]
  if (!els) return
  els.audioEl.srcObject = stream
  els.audioEl.play().catch(() => {})
}

// Called when a peer's audio/video stream loses all its tracks (they turned
// their mic/cam off via room.removeStream) — drop the stale stream so the
// tile cleanly falls back to the placeholder/no-audio state.
function handleRemoteStreamEmptied(peerId, type) {
  const stream = peerStreams[peerId]?.[type]
  if (!stream) return
  if (!stream.getTracks().every(t => t.readyState === 'ended')) return
  delete peerStreams[peerId][type]
  if (type === 'video') applyPeerVideo(peerId)
  else applyPeerAudio(peerId)
}

// Smart attach/detach that respects both global toggles and per-peer overrides.
// Rule: global off → always hidden/muted regardless of per-peer setting.
//       global on  → per-peer setting is respected.

function applyPeerAudio(peerId) {
  const els = peerElements[peerId]
  if (!els) return
  if (hearOn && !peerMuted[peerId]) {
    const stream = peerStreams[peerId]?.audio
    if (stream) attachPeerAudio(peerId, stream)
  } else {
    els.audioEl.srcObject = null
    els.audioEl.pause()
  }
}

function applyPeerVideo(peerId) {
  const els = peerElements[peerId]
  if (!els) return
  if (seeOn && !peerHidden[peerId]) {
    const stream = peerStreams[peerId]?.video
    if (stream) attachPeerVideo(peerId, stream)
    else detachPeerVideo(peerId)
  } else {
    detachPeerVideo(peerId)
  }
}

function togglePeerAudio(peerId) {
  if (!hearOn) {
    // Global EAR is off — turn it on and reveal this peer; leave others at their current state
    hearOn = true
    updateMediaButtons()
    peerMuted[peerId] = false
    for (const pid of Object.keys(peerElements)) applyPeerAudio(pid)
    sendMediaWantAll()
    updatePeerControls(peerId)
    return
  }
  peerMuted[peerId] = !peerMuted[peerId]
  applyPeerAudio(peerId)
  sendMediaWantTo(peerId)
  updatePeerControls(peerId)
}

function togglePeerVideo(peerId) {
  if (!seeOn) {
    // Global EYE is off — turn it on and reveal this peer; leave others at their current state
    seeOn = true
    updateMediaButtons()
    peerHidden[peerId] = false
    for (const pid of Object.keys(peerElements)) applyPeerVideo(pid)
    sendMediaWantAll()
    updatePeerControls(peerId)
    updateVideoArea()
    return
  }
  peerHidden[peerId] = !peerHidden[peerId]
  applyPeerVideo(peerId)
  sendMediaWantTo(peerId)
  updatePeerControls(peerId)
  updateVideoArea()
}

function updatePeerControls(peerId) {
  const els = peerElements[peerId]
  if (!els) return
  els.btnEar.classList.toggle('off', !!peerMuted[peerId])
  els.btnEye.classList.toggle('off', !!peerHidden[peerId])
}

// Shows a small "CAM" badge on a peer's tile when they've broadcast that
// their camera is on — even if our EYE is off and we're not viewing it.
function updatePeerCamBadge(peerId) {
  const els = peerElements[peerId]
  if (!els) return
  els.camBadge.classList.toggle('show', !!peerMediaState[peerId]?.cam)
}

// Shows a small "FILE" badge on a peer's tile when they've broadcast that
// they're accepting incoming files.
function updatePeerFileBadge(peerId) {
  const els = peerElements[peerId]
  if (!els) return
  els.fileBadge.classList.toggle('show', !!peerMediaState[peerId]?.file)
}

// ── speaker detection ────────────────────────────────────────────
// Per-peer Web Audio analyser that drives the "speaking" glow on a tile —
// a simple RMS-over-threshold check on each animation frame.

function setupSpeakerDetection(peerId, stream) {
  teardownSpeakerDetection(peerId)
  try {
    const ctx      = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.4
    ctx.createMediaStreamSource(stream).connect(analyser)

    const data = new Uint8Array(analyser.fftSize)
    let animId

    function tick() {
      animId = requestAnimationFrame(tick)
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / data.length)
      const box = peerElements[peerId]?.box
      if (box) box.classList.toggle('speaking', rms > 0.015)
      else cancelAnimationFrame(animId)
    }

    animId = requestAnimationFrame(tick)
    peerAnalysers[peerId] = { ctx, animId }
  } catch (e) {
    console.warn('[audio] speaker detection failed:', e)
  }
}

function teardownSpeakerDetection(peerId) {
  const a = peerAnalysers[peerId]
  if (!a) return
  cancelAnimationFrame(a.animId)
  a.ctx.close().catch(() => {})
  delete peerAnalysers[peerId]
  peerElements[peerId]?.box.classList.remove('speaking')
}

// ── peer latency (ping) ──────────────────────────────────────────
// Once a peer's nickname has resolved (they're "fully" in the room), poll
// room.ping(peerId) every 5s and show the round-trip time on their tile.
// 3 consecutive failures surface as an early "connection unstable" warning,
// well before the WebRTC connection itself times out.

function startPeerPing(r, peerId) {
  stopPeerPing(peerId)
  peerPingFails[peerId] = 0
  peerPingTimers[peerId] = setInterval(async () => {
    if (!peerElements[peerId]) return
    try {
      const ms = await r.ping(peerId)
      peerPingFails[peerId] = 0
      updatePeerLatency(peerId, ms)
    } catch {
      peerPingFails[peerId] = (peerPingFails[peerId] || 0) + 1
      updatePeerLatency(peerId, null)
      if (peerPingFails[peerId] === 3) {
        const nick = peerNicks[peerId] || peerId.slice(0, 8) + '…'
        sysMsg(`${nick} connection unstable`)
      }
    }
  }, 5000)
}

function stopPeerPing(peerId) {
  if (peerPingTimers[peerId]) {
    clearInterval(peerPingTimers[peerId])
    delete peerPingTimers[peerId]
  }
  delete peerPingFails[peerId]
}

function clearAllPeerPings() {
  for (const peerId of Object.keys(peerPingTimers)) stopPeerPing(peerId)
}

function updatePeerLatency(peerId, ms) {
  const els = peerElements[peerId]
  if (!els) return
  els.latencyEl.classList.remove('lat-good', 'lat-warn', 'lat-bad')
  if (ms == null) {
    els.latencyEl.textContent = '—'
  } else {
    els.latencyEl.textContent = `${ms}ms`
    els.latencyEl.classList.add(ms < 100 ? 'lat-good' : ms <= 300 ? 'lat-warn' : 'lat-bad')
  }
}

// ── media toggles ────────────────────────────────────────────────
// User-facing MIC/CAM (outgoing) and EAR/EYE (incoming) toggles. MIC/CAM
// request device permission on first use and add/remove streams from the
// active room; EAR/EYE just gate playback of already-received streams.

async function toggleMic() {
  if (!micOn) {
    try {
      localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: micConstraint(), video: false })
      micOn = true
      if (room) {
        const targets = Object.keys(peerWants).filter(id => peerWants[id]?.audio)
        if (targets.length) {
          room.addTrack(localAudioStream.getAudioTracks()[0], localAudioStream, { target: targets, metadata: { type: 'audio' } })
          targets.forEach(id => sendingAudioTo.add(id))
        }
      }
      broadcastMediaState()
      sysMsg('Microphone on.')
    } catch (e) {
      sysMsg(`Mic unavailable: ${e.message}`)
    }
  } else {
    micOn = false
    if (room && localAudioStream && sendingAudioTo.size) {
      room.removeTrack(localAudioStream.getAudioTracks()[0], { target: [...sendingAudioTo] })
    }
    sendingAudioTo.clear()
    localAudioStream?.getTracks().forEach(t => t.stop())
    localAudioStream = null
    broadcastMediaState()
    sysMsg('Microphone off.')
  }
  updateMediaButtons()
}

async function toggleCam() {
  if (!camOn) {
    try {
      localVideoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: camConstraint() })
      camOn = true
      $selfPreview.srcObject = localVideoStream
      if (room) {
        const targets = Object.keys(peerWants).filter(id => peerWants[id]?.video)
        if (targets.length) {
          room.addTrack(localVideoStream.getVideoTracks()[0], localVideoStream, { target: targets, metadata: { type: 'video' } })
          targets.forEach(id => sendingVideoTo.add(id))
        }
      }
      broadcastMediaState()
      sysMsg('Camera on.')
    } catch (e) {
      sysMsg(`Camera unavailable: ${e.message}`)
    }
  } else {
    camOn = false
    if (room && localVideoStream && sendingVideoTo.size) {
      room.removeTrack(localVideoStream.getVideoTracks()[0], { target: [...sendingVideoTo] })
    }
    sendingVideoTo.clear()
    localVideoStream?.getTracks().forEach(t => t.stop())
    localVideoStream = null
    $selfPreview.srcObject = null
    broadcastMediaState()
    sysMsg('Camera off.')
  }
  updateMediaButtons()
  updateVideoArea()
}

// ── device switching ────────────────────────────────────────────
// Lets the user pick a specific mic/camera in Settings. If MIC/CAM is
// already on, the new device's track replaces the old one in-place via
// room.replaceTrack — seamless for connected peers. If we're not in a
// room, the local stream is just swapped.

function micConstraint() {
  return selectedMicId === 'default' ? true : { deviceId: { exact: selectedMicId } }
}

function camConstraint() {
  return selectedCamId === 'default' ? true : { deviceId: { exact: selectedCamId } }
}

async function switchMicDevice(deviceId) {
  const newStream = await navigator.mediaDevices.getUserMedia({
    audio: deviceId === 'default' ? true : { deviceId: { exact: deviceId } },
    video: false
  })
  const newTrack = newStream.getAudioTracks()[0]
  const oldStream = localAudioStream
  const oldTrack = oldStream?.getAudioTracks()[0]

  if (room && oldStream && oldTrack) {
    await Promise.all(room.replaceTrack(oldTrack, newTrack, { metadata: { type: 'audio' } }))
    oldStream.removeTrack(oldTrack)
    oldStream.addTrack(newTrack)
    oldTrack.stop()
    newStream.getTracks().forEach(t => { if (t !== newTrack) t.stop() })
  } else {
    oldStream?.getTracks().forEach(t => t.stop())
    localAudioStream = newStream
  }
  selectedMicId = deviceId
}

async function switchCamDevice(deviceId) {
  const newStream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: deviceId === 'default' ? true : { deviceId: { exact: deviceId } }
  })
  const newTrack = newStream.getVideoTracks()[0]
  const oldStream = localVideoStream
  const oldTrack = oldStream?.getVideoTracks()[0]

  if (room && oldStream && oldTrack) {
    await Promise.all(room.replaceTrack(oldTrack, newTrack, { metadata: { type: 'video' } }))
    oldStream.removeTrack(oldTrack)
    oldStream.addTrack(newTrack)
    oldTrack.stop()
    newStream.getTracks().forEach(t => { if (t !== newTrack) t.stop() })
  } else {
    oldStream?.getTracks().forEach(t => t.stop())
    localVideoStream = newStream
  }
  $selfPreview.srcObject = localVideoStream
  selectedCamId = deviceId
}

async function onMicSelectChange() {
  const deviceId = $micSelect.value
  if (!micOn) {
    selectedMicId = deviceId
    return
  }
  try {
    await switchMicDevice(deviceId)
    sysMsg('Microphone switched.')
  } catch (e) {
    sysMsg(`Mic switch failed: ${e.message}`)
    $micSelect.value = selectedMicId
  }
}

async function onCamSelectChange() {
  const deviceId = $camSelect.value
  if (!camOn) {
    selectedCamId = deviceId
    return
  }
  try {
    await switchCamDevice(deviceId)
    sysMsg('Camera switched.')
  } catch (e) {
    sysMsg(`Camera switch failed: ${e.message}`)
    $camSelect.value = selectedCamId
  }
}

async function refreshDeviceLists() {
  let devices
  try {
    devices = await navigator.mediaDevices.enumerateDevices()
  } catch {
    return
  }
  populateDeviceSelect($micSelect, devices.filter(d => d.kind === 'audioinput'), selectedMicId)
  populateDeviceSelect($camSelect, devices.filter(d => d.kind === 'videoinput'), selectedCamId)
}

function populateDeviceSelect(select, devices, selectedId) {
  select.innerHTML = '<option value="default">Default</option>'
  devices.forEach((d, i) => {
    const opt = document.createElement('option')
    opt.value = d.deviceId
    opt.textContent = d.label || `Device ${i + 1}`
    select.appendChild(opt)
  })
  select.value = devices.some(d => d.deviceId === selectedId) ? selectedId : 'default'
}

// Handle a device disappearing mid-call: try to fall back to the default
// device, and if that also fails, just turn the affected toggle off.
async function handleDeviceChange() {
  let devices
  try {
    devices = await navigator.mediaDevices.enumerateDevices()
  } catch {
    return
  }
  const mics = devices.filter(d => d.kind === 'audioinput')
  const cams = devices.filter(d => d.kind === 'videoinput')

  if (selectedMicId !== 'default' && !mics.some(d => d.deviceId === selectedMicId)) {
    if (micOn) {
      try {
        await switchMicDevice('default')
        sysMsg('Microphone disconnected — switched to default.')
      } catch {
        micOn = false
        if (room && localAudioStream && sendingAudioTo.size) {
          room.removeTrack(localAudioStream.getAudioTracks()[0], { target: [...sendingAudioTo] })
        }
        sendingAudioTo.clear()
        localAudioStream?.getTracks().forEach(t => t.stop())
        localAudioStream = null
        broadcastMediaState()
        updateMediaButtons()
        sysMsg('Microphone disconnected.')
      }
    } else {
      selectedMicId = 'default'
    }
  }

  if (selectedCamId !== 'default' && !cams.some(d => d.deviceId === selectedCamId)) {
    if (camOn) {
      try {
        await switchCamDevice('default')
        sysMsg('Camera disconnected — switched to default.')
      } catch {
        camOn = false
        if (room && localVideoStream && sendingVideoTo.size) {
          room.removeTrack(localVideoStream.getVideoTracks()[0], { target: [...sendingVideoTo] })
        }
        sendingVideoTo.clear()
        localVideoStream?.getTracks().forEach(t => t.stop())
        localVideoStream = null
        $selfPreview.srcObject = null
        updateVideoArea()
        broadcastMediaState()
        updateMediaButtons()
        sysMsg('Camera disconnected.')
      }
    } else {
      selectedCamId = 'default'
    }
  }

  if ($settingsPanel.classList.contains('open')) refreshDeviceLists()
}

function toggleEar() {
  hearOn = !hearOn
  for (const peerId of Object.keys(peerElements)) applyPeerAudio(peerId)
  sendMediaWantAll()
  updateMediaButtons()
  sysMsg(hearOn ? 'Incoming audio on.' : 'Incoming audio off.')
}

function toggleEye() {
  seeOn = !seeOn
  for (const peerId of Object.keys(peerElements)) applyPeerVideo(peerId)
  sendMediaWantAll()
  updateMediaButtons()
  updateVideoArea()
  sysMsg(seeOn ? 'Incoming video on.' : 'Incoming video off.')
}

// FILE off (default) means incoming file transfers are silently dropped —
// senders get no indication that we rejected them. Broadcast our state so
// peers know whether to bother sending us anything (see onFileSelected).
function toggleFile() {
  fileAcceptOn = !fileAcceptOn
  broadcastMediaState()
  updateMediaButtons()
  sysMsg(fileAcceptOn ? 'File receiving on.' : 'File receiving off.')
}

// ── file sharing ─────────────────────────────────────────────────
// Files are sent as binary blobs over Trystero's 'file' action — chunking
// and per-chunk progress are handled natively. Everything stays in memory;
// the only path to disk is the user explicitly clicking "Save".

function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function progressBarText(label, frac) {
  const width = 10
  const filled = Math.max(0, Math.min(width, Math.round(frac * width)))
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled)
  return `${label} [${bar}] ${Math.round(frac * 100)}%`
}

function genTransferId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

// A file transfer message: timestamp + nick/body header, with thumbnail,
// progress bar, and/or type-specific inline content appended as it becomes
// available.
function createFileMsg(headerHtml) {
  const el = document.createElement('div')
  el.className = 'msg file-msg'
  el.innerHTML = `<div class="file-msg-header"><span class="ts">${ts()}</span>${headerHtml}</div>`
  $msgs.appendChild(el)
  $msgs.scrollTop = $msgs.scrollHeight
  return el
}

function addProgressBar(el, label, frac) {
  const p = document.createElement('div')
  p.className = 'file-progress-text'
  p.textContent = progressBarText(label, frac)
  el.appendChild(p)
  return p
}

function updateProgressBar(p, label, frac) {
  p.textContent = progressBarText(label, frac)
}

// Adds an image thumbnail. If `fullUrl` is given, the thumbnail is
// click-to-expand via the lightbox.
function addThumb(el, src, fullUrl) {
  const img = document.createElement('img')
  img.className = 'file-thumb'
  img.src = src
  if (fullUrl) {
    img.title = 'Click to view full size'
    img.style.cursor = 'zoom-in'
    img.addEventListener('click', () => showImageLightbox(fullUrl))
  }
  el.appendChild(img)
  return img
}

function isTextFile(metadata) {
  if (metadata.type?.startsWith('text/')) return true
  if (metadata.type === 'application/json') return true
  return /\.(txt|md|json|csv|log)$/i.test(metadata.name || '')
}

async function addTextPreview(el, blob) {
  const text = await blob.text()
  const lines = text.split('\n')
  const pre = document.createElement('pre')
  pre.className = 'file-text-preview'
  pre.textContent = lines.slice(0, 20).join('\n') + (lines.length > 20 ? '\n…' : '')
  el.appendChild(pre)
}

function addAudioPlayer(el, url) {
  const audio = document.createElement('audio')
  audio.className = 'file-audio'
  audio.controls = true
  audio.src = url
  el.appendChild(audio)
}

function addVideoPlayer(el, url) {
  const video = document.createElement('video')
  video.className = 'file-video'
  video.controls = true
  video.src = url
  el.appendChild(video)
}

function addSaveButton(el, blob, name) {
  const saveBtn = document.createElement('button')
  saveBtn.className = 'media-btn file-save-btn'
  saveBtn.textContent = 'Save'
  saveBtn.addEventListener('click', () => saveReceivedFile(blob, name))
  el.appendChild(saveBtn)
}

function addFileCard(el, blob, metadata) {
  const card = document.createElement('div')
  card.className = 'file-card'
  const name = document.createElement('span')
  name.textContent = `${metadata.name} (${formatBytes(metadata.size)})`
  card.appendChild(name)
  el.appendChild(card)
  addSaveButton(card, blob, metadata.name)
}

// Renders the type-appropriate inline content for a completed transfer.
// `existingThumb`, if present, is the small base64 thumbnail shown while
// the transfer was in progress — upgraded to the full-size image here.
async function renderInlineContent(el, blob, metadata, existingThumb) {
  const type = metadata.type || ''
  if (type.startsWith('image/')) {
    const url = URL.createObjectURL(blob)
    if (existingThumb) {
      existingThumb.src = url
      existingThumb.title = 'Click to view full size'
      existingThumb.style.cursor = 'zoom-in'
      existingThumb.addEventListener('click', () => showImageLightbox(url))
    } else {
      addThumb(el, url, url)
    }
  } else if (isTextFile(metadata)) {
    await addTextPreview(el, blob)
    addSaveButton(el, blob, metadata.name)
  } else if (type.startsWith('audio/')) {
    addAudioPlayer(el, URL.createObjectURL(blob))
    addSaveButton(el, blob, metadata.name)
  } else if (type.startsWith('video/')) {
    addVideoPlayer(el, URL.createObjectURL(blob))
    addSaveButton(el, blob, metadata.name)
  } else {
    addFileCard(el, blob, metadata)
  }
}

// Re-encodes an image through a canvas so it's exported as a fresh blob
// with no EXIF/metadata, and generates a small thumbnail (base64 data URL)
// for instant previews on both ends. Falls back to the original file (and
// no thumbnail) if decoding fails (e.g. an image type the renderer can't
// display, like some RAW formats).
function processImage(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const fullCanvas = document.createElement('canvas')
      fullCanvas.width  = img.naturalWidth
      fullCanvas.height = img.naturalHeight
      fullCanvas.getContext('2d').drawImage(img, 0, 0)
      const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'

      const scale = THUMBNAIL_WIDTH / img.naturalWidth
      const thumbW = THUMBNAIL_WIDTH
      const thumbH = Math.max(1, Math.round(img.naturalHeight * scale))
      const thumbCanvas = document.createElement('canvas')
      thumbCanvas.width  = thumbW
      thumbCanvas.height = thumbH
      thumbCanvas.getContext('2d').drawImage(img, 0, 0, thumbW, thumbH)
      const thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.6)

      fullCanvas.toBlob(blob => {
        URL.revokeObjectURL(url)
        resolve({ blob: blob || file, thumbnail })
      }, outType, 0.92)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve({ blob: file, thumbnail: null })
    }
    img.src = url
  })
}

// Tracks per-transfer progress for incoming files, keyed by peer + transferId
// so multiple simultaneous transfers each get their own message/progress bar.
function transferKey(peerId, metadata) {
  return `${peerId}:${metadata?.transferId || 'legacy'}`
}

function updateReceivingProgress(peerId, metadata, progress) {
  const nick = peerNicks[peerId] || 'Someone'
  const key = transferKey(peerId, metadata)
  let t = receivingTransfers[key]
  if (!t) {
    const el = createFileMsg(`<span class="nick peer">${escHtml(nick)}</span><span class="body">sending ${escHtml(metadata.name)} (${formatBytes(metadata.size)})…</span>`)
    const thumbEl = metadata.thumbnail ? addThumb(el, metadata.thumbnail) : null
    const progressEl = addProgressBar(el, `Receiving ${metadata.name}`, progress)
    t = { el, progressEl, thumbEl }
    receivingTransfers[key] = t
  } else {
    updateProgressBar(t.progressEl, `Receiving ${metadata.name}`, progress)
  }
}

function showImageLightbox(url) {
  let overlay = document.getElementById('image-lightbox')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'image-lightbox'
    overlay.className = 'hidden'
    overlay.addEventListener('click', () => overlay.classList.add('hidden'))
    document.body.appendChild(overlay)
  }
  overlay.innerHTML = ''
  const img = document.createElement('img')
  img.src = url
  overlay.appendChild(img)
  overlay.classList.remove('hidden')
}

async function saveReceivedFile(blob, name) {
  const buf = await blob.arrayBuffer()
  const result = await window.__electron.saveFile(buf, name)
  if (result?.saved) sysMsg(`Saved ${name}.`)
}

// Renders a completed incoming file, replacing the in-progress message (if
// any) with the type-appropriate inline content — image, text preview,
// audio/video player, or filename/size card with a Save button.
async function renderReceivedFile(peerId, data, metadata) {
  const nick = peerNicks[peerId] || (isAbscondedRoom ? 'Stranger' : 'Someone')
  const blob = new Blob([data], { type: metadata.type || 'application/octet-stream' })

  const key = transferKey(peerId, metadata)
  const existing = receivingTransfers[key]
  delete receivingTransfers[key]

  let el = existing?.el
  if (existing) existing.progressEl.remove()
  else el = createFileMsg(`<span class="nick peer">${escHtml(nick)}</span><span class="body"></span>`)

  el.querySelector('.body').textContent = `sent ${metadata.name} (${formatBytes(metadata.size)})`
  await renderInlineContent(el, blob, metadata, existing?.thumbEl)
  $msgs.scrollTop = $msgs.scrollHeight
}

// Sends a single file: strips EXIF + generates a thumbnail for images,
// shows an immediate preview in our own chat (instant feedback before the
// transfer even starts), then sends with per-file progress tracking.
async function sendOneFile(file, targets) {
  let blob = file
  let thumbnail = null
  if (file.type.startsWith('image/')) {
    const result = await processImage(file)
    blob = result.blob
    thumbnail = result.thumbnail
  }

  const transferId = genTransferId()
  const metadata = { name: file.name, type: file.type || 'application/octet-stream', size: blob.size, transferId }
  if (thumbnail) metadata.thumbnail = thumbnail

  const el = createFileMsg(`<span class="nick self">${escHtml(MY_NICK)}</span><span class="body">sending ${escHtml(file.name)} (${formatBytes(blob.size)})…</span>`)
  const thumbEl = thumbnail ? addThumb(el, thumbnail) : null
  const progressEl = addProgressBar(el, `Sending ${file.name}`, 0)

  try {
    await sendFile(blob, {
      target: targets,
      metadata,
      onProgress: (progress) => updateProgressBar(progressEl, `Sending ${file.name}`, progress),
    })
    progressEl.remove()
    el.querySelector('.body').textContent = `sent ${file.name} (${formatBytes(blob.size)})`
    if (thumbEl) {
      const url = URL.createObjectURL(blob)
      thumbEl.src = url
      thumbEl.title = 'Click to view full size'
      thumbEl.style.cursor = 'zoom-in'
      thumbEl.addEventListener('click', () => showImageLightbox(url))
    }
  } catch (e) {
    progressEl.textContent = `Failed to send ${file.name}: ${e.message}`
  }
  $msgs.scrollTop = $msgs.scrollHeight
}

// Sends a list of files sequentially (used by both the 📎 file picker and
// drag-and-drop). Sends only to peers who've broadcast file: true via
// media-state — targeted the same way as audio/video (#12), so
// non-consenting peers' bandwidth is never touched.
async function sendFiles(files) {
  if (!room) {
    sysMsg('Join a room before sending files.')
    return
  }

  const targets = Object.keys(peerNicks).filter(id => peerMediaState[id]?.file)
  if (targets.length === 0) {
    sysMsg('No one here has FILE receiving enabled.')
    return
  }

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      sysMsg(`File too large: ${file.name} (${formatBytes(file.size)}, max ${formatBytes(MAX_FILE_SIZE)}).`)
      continue
    }
    await sendOneFile(file, targets)
  }
}

// Triggered by the attach (📎) button's file picker.
async function onFileSelected() {
  const files = Array.from($fileInput.files)
  $fileInput.value = ''
  if (files.length) await sendFiles(files)
}

// ── media stream handlers ────────────────────────────────────────
// Wires up incoming audio/video streams from peers and broadcasts our own
// MIC/CAM state so peers can show a "peer: mic cam" indicator.

function setupMediaHandlers(r) {
  const mediaStateAction = r.makeAction('media-state')
  sendMediaState = mediaStateAction.send

  // Targeted streaming — peers tell us what they want to receive from us
  // (driven by their EAR/EYE toggles), and we addTrack/removeTrack our
  // mic/cam only to those peers.
  const mediaReqAction = r.makeAction('media-req')
  sendMediaWant = mediaReqAction.send

  mediaReqAction.onMessage = (data, { peerId }) => {
    peerWants[peerId] = data

    if (micOn && localAudioStream) {
      const track = localAudioStream.getAudioTracks()[0]
      if (data.audio && !sendingAudioTo.has(peerId)) {
        room.addTrack(track, localAudioStream, { target: peerId, metadata: { type: 'audio' } })
        sendingAudioTo.add(peerId)
      } else if (!data.audio && sendingAudioTo.has(peerId)) {
        room.removeTrack(track, { target: peerId })
        sendingAudioTo.delete(peerId)
      }
    }

    if (camOn && localVideoStream) {
      const track = localVideoStream.getVideoTracks()[0]
      if (data.video && !sendingVideoTo.has(peerId)) {
        room.addTrack(track, localVideoStream, { target: peerId, metadata: { type: 'video' } })
        sendingVideoTo.add(peerId)
      } else if (!data.video && sendingVideoTo.has(peerId)) {
        room.removeTrack(track, { target: peerId })
        sendingVideoTo.delete(peerId)
      }
    }
  }

  // onPeerTrack fires once per track, with the parent stream alongside it —
  // unlike onPeerStream, adding a second track (e.g. mic) to an existing
  // connection only triggers handling for that track, not a re-fire for
  // tracks already attached (e.g. the video already playing).
  r.onPeerTrack = (track, stream, peerId, metadata) => {
    // Metadata is the source of truth; fall back to the track's own kind
    // if it's missing (e.g. an older/non-conforming peer).
    let type = metadata?.type
    if (type !== 'audio' && type !== 'video') {
      type = track.kind === 'video' ? 'video' : 'audio'
    }
    if (!peerStreams[peerId]) peerStreams[peerId] = {}
    peerStreams[peerId][type] = stream

    // Trystero has no "stream removed" event — when the peer turns their
    // mic/cam off (room.removeTrack), the same MediaStream object lives on
    // here with its track(s) ended/removed. Watch for that so we drop the
    // stale stream and fall back to the placeholder/no-audio state cleanly.
    const onEmptied = () => handleRemoteStreamEmptied(peerId, type)
    stream.onremovetrack = onEmptied
    track.onended = onEmptied

    if (type === 'audio') {
      setupSpeakerDetection(peerId, stream)
      applyPeerAudio(peerId)
    } else if (type === 'video') {
      applyPeerVideo(peerId)
    }
  }

  mediaStateAction.onMessage = (state, { peerId }) => {
    peerMediaState[peerId] = state
    updatePeerCamBadge(peerId)
    updatePeerFileBadge(peerId)

    const parts = []
    if (state.mic) parts.push('mic')
    if (state.cam) parts.push('cam')
    $peerStatus.textContent = parts.length ? `peer: ${parts.join(' ')}` : ''
  }

  // File sharing — binary action, chunked/progress-tracked natively by
  // Trystero. Receiving side only does anything if FILE is on; otherwise
  // the transfer is silently dropped (sender gets no indication).
  const fileAction = r.makeAction('file')
  sendFile = fileAction.send

  fileAction.onReceiveProgress = (progress, { peerId, metadata }) => {
    if (!fileAcceptOn || !metadata) return
    updateReceivingProgress(peerId, metadata, progress)
  }

  fileAction.onMessage = (data, { peerId, metadata }) => {
    if (!fileAcceptOn || !metadata) return
    renderReceivedFile(peerId, data, metadata)
  }
}

function cleanupMedia() {
  localAudioStream?.getTracks().forEach(t => t.stop())
  localVideoStream?.getTracks().forEach(t => t.stop())
  localAudioStream = null
  localVideoStream = null

  for (const peerId of [...Object.keys(peerElements)]) {
    teardownSpeakerDetection(peerId)
    const els = peerElements[peerId]
    if (els) { els.audioEl.srcObject = null; els.audioEl.pause(); els.box.remove() }
    delete peerElements[peerId]
    delete peerStreams[peerId]
  }

  $selfPreview.srcObject = null
  $audioOverflow.style.display = 'none'
  micOn = camOn = hearOn = seeOn = fileAcceptOn = false
  sendMediaState = null
  sendMediaWant = null
  sendFile = null
  sendingAudioTo.clear()
  sendingVideoTo.clear()
  for (const k of Object.keys(peerMuted))  delete peerMuted[k]
  for (const k of Object.keys(peerHidden)) delete peerHidden[k]
  for (const k of Object.keys(peerWants))  delete peerWants[k]
  for (const k of Object.keys(receivingTransfers)) delete receivingTransfers[k]

  updateMediaButtons()
  updateVideoArea()
  $peerStatus.textContent = ''
}

// ── room password / lock UI ──────────────────────────────────────
// The password field only makes sense when the user is about to type/Join
// a named room — hidden once the room input is disabled (Random mode,
// searching, or already connected).

function updateRoomPassVisibility() {
  $roomPass.style.display = (!$roomInput.disabled && $roomInput.value.trim()) ? '' : 'none'
}

function updateRoomLock() {
  $roomLock.style.display = activeRoomPassword ? '' : 'none'
}

// ── UI state setters ─────────────────────────────────────────────
// Each function below puts the toolbar/status pill into one of the app's
// top-level modes (idle, searching, matched with a stranger, in a named room).
// Only one of these is "active" at a time.

function setDisconnected() {
  $status.textContent = '● disconnected'
  $status.className   = ''
  $input.disabled     = true
  $send.disabled      = true
  $join.style.display   = ''
  $random.style.display = ''
  $copy.style.display   = 'none'
  $leave.style.display  = 'none'
  $return.style.display = 'none'
  $next.style.display   = 'none'
  $stop.style.display   = 'none'
  $roomInput.disabled   = false
  document.body.classList.remove('group-room')
  peerNicks = {}
  updatePeerCount()
  activeRoomPassword = null
  updateRoomLock()
  updateRoomPassVisibility()
}

function setSearching() {
  $status.textContent = '◌ looking...'
  $status.className   = 'searching'
  $input.disabled     = true
  $send.disabled      = true
  $join.style.display   = 'none'
  $random.style.display = 'none'
  $leave.style.display  = 'none'
  $return.style.display = 'none'
  $next.style.display   = 'none'
  $stop.style.display   = ''
  $roomInput.disabled   = true
  peerNicks = {}
  updatePeerCount()
  updateRoomPassVisibility()
}

function setMatched() {
  $status.textContent = '● stranger'
  $status.className   = 'connected'
  $input.disabled     = false
  $send.disabled      = false
  $join.style.display   = 'none'
  $random.style.display = 'none'
  $leave.style.display  = 'none'
  $return.style.display = 'none'
  $next.style.display   = ''
  $stop.style.display   = ''
  $roomInput.disabled   = true
  updateRoomPassVisibility()
}

function setConnected(roomName) {
  $status.textContent = `● ${roomName}`
  $status.className   = 'connected'
  $input.disabled     = false
  $send.disabled      = false
  $join.style.display   = 'none'
  $random.style.display = 'none'
  $copy.style.display   = ''
  $leave.style.display  = ''
  $return.style.display = 'none'
  $next.style.display   = 'none'
  $stop.style.display   = 'none'
  $roomInput.disabled   = true
  updateRoomPassVisibility()
}

// ── shared room wiring ───────────────────────────────────────────
// Common setup applied to every Trystero room (named, private match, or
// abscond). Action names are kept short — Trystero limits them to 12 bytes.
// `isPrivate` controls 1-on-1 wording ("Stranger"); `isAbscond` skips the
// abscond-request actions, since you can't abscond from an abscond room.

function wireRoomHandlers(r, isPrivate, isAbscond = false) {
  const chatAction = r.makeAction('chat')
  sendMsg = chatAction.send

  // Abscond action — group rooms only. Request/response: the requester's
  // request() resolves/rejects based on what the receiver's onRequest
  // promise does (see onIncomingAbscond).
  if (!isPrivate && !isAbscond) {
    abscondAction = r.makeAction('abscond', {
      kind: 'request',
      onRequest: (data, { peerId }) => onIncomingAbscond(data, peerId),
    })
  }

  // Nicknames are exchanged during the handshake (see exchangeNickHandshake),
  // so peerNicks[peerId] is already populated by the time onPeerJoin fires.
  r.onPeerJoin = peerId => {
    hasHadPeerJoinThisRoom = true

    const nick = peerNicks[peerId] || peerId.slice(0, 8) + '…'
    createPeerBox(peerId)
    updateGridLayout()
    applyPeerAudio(peerId)
    applyPeerVideo(peerId)
    startPeerPing(r, peerId)
    // Let the newly-joined peer know our current mic/cam state right away —
    // they weren't connected for any earlier broadcastMediaState() calls.
    if (sendMediaState) sendMediaState({ mic: micOn, cam: camOn, file: fileAcceptOn }, { target: peerId })
    // ...and tell them whether we want their audio/video, so they can
    // targeted-addTrack to us if their mic/cam is already on.
    sendMediaWantTo(peerId)
    if (isAbscond) {
      sysMsg(`It's just you and ${nick}. Say hi!`)
    } else {
      sysMsg(isPrivate ? `Connected to ${nick}. Say hi!` : `${nick} is here`)
    }
    if (!isPrivate && !isAbscond && Object.keys(peerElements).length === 6 && !largeRoomWarned) {
      largeRoomWarned = true
      sysMsg('Note: large P2P rooms may affect performance.')
    }
    updatePeerCount()
  }

  r.onPeerLeave = peerId => {
    const nick = peerNicks[peerId] || (isPrivate ? 'Stranger' : 'Someone')
    if (isAbscond) {
      sysMsg(`${nick} has left. Click ↩ Return to go back.`)
    } else if (isPrivate) {
      sysMsg(`${nick} has disconnected. Click Next to find someone new.`)
    } else {
      sysMsg(`${nick} has vanished into the void`)
    }
    removePeerBox(peerId)
    delete peerNicks[peerId]
    delete peerWants[peerId]
    sendingAudioTo.delete(peerId)
    sendingVideoTo.delete(peerId)
    for (const k of Object.keys(receivingTransfers)) {
      if (k.startsWith(`${peerId}:`)) delete receivingTransfers[k]
    }
    updateGridLayout()
    updatePeerCount()
  }

  chatAction.onMessage = (body, { peerId }) => {
    const nick = peerNicks[peerId] || (isPrivate ? 'Stranger' : 'Someone')
    chatMsg(nick, body, false)
  }

  try {
    setupMediaHandlers(r)
  } catch (e) {
    console.error('[media] setup failed:', e)
  }
}

// ── named room logic ──────────────────────────────────────────────
// Joining/leaving a user-typed room name (the "Join" button path).

async function joinRoomNamed(name) {
  if (!vpnCheck()) return
  if (trackerStatus === 'down') {
    sysMsg('⚠ All BitTorrent trackers are unreachable. Try again once TRACKERS recovers.')
    return
  }
  if (room) await leaveRoom()
  const roomId = name.trim().toLowerCase().replace(/\s+/g, '-')
  if (!roomId) return
  $roomInput.value = roomId
  currentRoomId = roomId
  isAbscondedRoom = false
  document.body.classList.add('group-room')
  const password = $roomPass.value
  activeRoomPassword = password || null
  $roomPass.value = ''
  sysMsg(`Joining room "${roomId}"…`)
  room = joinTrysteroRoom(roomId, password)
  wireRoomHandlers(room, false)
  setConnected(roomId)
  updateRoomLock()
  sysMsg(`You joined as ${MY_NICK}`)

  // Trystero gives a wrong-password joiner no error of their own — only
  // existing members find out (and we silence that, see handleJoinError).
  // So if a password-protected join still has zero peers after a while,
  // give the user an honest heads-up without forcing them out — they might
  // just be the first one here.
  if (password) {
    const myRoom = room
    setTimeout(() => {
      if (room !== myRoom || hasHadPeerJoinThisRoom) return
      sysMsg('No response from anyone yet — double-check your password, or you may be the first one here.')
    }, 12_000)
  }
}

async function leaveRoom() {
  if (!room) return
  room.leave()
  room = null
  sendMsg = null
  largeRoomWarned = false
  resetAbscondState()
  clearAllPeerPings()
  cleanupMedia()
  sysMsg('You left the room.')
  setDisconnected()
}

// ── abscond ──────────────────────────────────────────────────────
// "Abscond" lets two people in a group room break off into a private room
// together. One side requests, the other accepts/declines; a decline looks
// identical to a timeout (15s) so the requester can't tell the difference.

function resetAbscondState() {
  if (incomingAbscondTimer) { clearTimeout(incomingAbscondTimer); incomingAbscondTimer = null }
  if (incomingAbscondEl) { incomingAbscondEl.remove(); incomingAbscondEl = null }
  abscondingTo     = null
  abscondAction    = null
  abscondBlocked.clear()
  currentRoomId    = null
  isAbscondedRoom  = false
  abscondOriginRoom = null
  document.body.classList.remove('group-room')
}

// Sends an abscond request and waits for the peer's response. Trystero
// resolves the request's promise with whatever the receiver's onRequest
// promise resolves to (see onIncomingAbscond), and rejects it on decline
// or after timeoutMs with no response — both cases read the same to the
// requester ("expired"), so a decline can't be distinguished from a timeout.
async function requestAbscond(peerId) {
  const nick = peerNicks[peerId] || peerId.slice(0, 8) + '…'

  if (abscondBlocked.has(peerId) || !abscondAction || abscondingTo) {
    sysMsg(`You wish to abscond with ${nick}… awaiting their reply.`)
    setTimeout(() => sysMsg('Your request to abscond has expired.'), 15_000)
    return
  }

  abscondingTo = peerId
  sysMsg(`You wish to abscond with ${nick}… awaiting their reply.`)
  const originRoom = currentRoomId

  try {
    const { room: newRoomName } = await abscondAction.request({ nick: MY_NICK }, { target: peerId, timeoutMs: 15_000 })
    abscondingTo = null
    enterAbscondedRoom(newRoomName, originRoom)
  } catch (e) {
    abscondingTo = null
    abscondBlocked.add(peerId)
    sysMsg('Your request to abscond has expired.')
  }
}

// Shows the "X wishes to abscond with you" prompt and returns a promise that
// the request/response action uses as the reply: resolving (Accept) sends
// the new room name back to the requester, rejecting (Decline, or no
// response within 15s) sends a rejection that reads as "expired" to them.
function onIncomingAbscond({ nick }, fromPeerId) {
  if (incomingAbscondTimer) { clearTimeout(incomingAbscondTimer); incomingAbscondTimer = null }
  if (incomingAbscondEl) incomingAbscondEl.remove()

  const fromName = peerNicks[fromPeerId] || nick || fromPeerId.slice(0, 8) + '…'

  return new Promise((resolve, reject) => {
    const el = document.createElement('div')
    el.className = 'msg abscond-prompt'

    const tsEl = document.createElement('span')
    tsEl.className = 'ts'
    tsEl.textContent = ts()

    const text = document.createElement('span')
    text.className = 'abscond-prompt-text'
    text.textContent = `${fromName} wishes to abscond with you.`

    const btns = document.createElement('div')
    btns.className = 'abscond-btns'

    const cleanup = () => {
      if (incomingAbscondTimer) { clearTimeout(incomingAbscondTimer); incomingAbscondTimer = null }
      el.remove()
      incomingAbscondEl = null
      abscondBlocked.add(fromPeerId)
    }

    const btnAccept = document.createElement('button')
    btnAccept.className = 'abscond-accept'
    btnAccept.textContent = 'Accept'
    btnAccept.addEventListener('click', () => {
      cleanup()
      const newRoomName = 'pv-x-' + randomHex(16)
      const originRoom  = currentRoomId
      resolve({ room: newRoomName })
      // Let the response send (queued on resolve) go out over the current
      // room's connection before we leave it for the new one.
      setTimeout(() => enterAbscondedRoom(newRoomName, originRoom), 0)
    })

    const btnDecline = document.createElement('button')
    btnDecline.className = 'abscond-decline'
    btnDecline.textContent = 'Decline'
    btnDecline.addEventListener('click', () => {
      cleanup()
      reject(new Error('declined'))
    })

    btns.appendChild(btnAccept)
    btns.appendChild(btnDecline)
    el.appendChild(tsEl)
    el.appendChild(text)
    el.appendChild(btns)
    $msgs.appendChild(el)
    $msgs.scrollTop = $msgs.scrollHeight
    incomingAbscondEl = el

    incomingAbscondTimer = setTimeout(() => {
      cleanup()
      reject(new Error('no response'))
    }, 15_000)
  })
}

function enterAbscondedRoom(newRoomName, originRoomId) {
  abscondOriginRoom = originRoomId
  isAbscondedRoom   = true

  // Teardown group room state without calling setDisconnected
  if (incomingAbscondTimer) { clearTimeout(incomingAbscondTimer); incomingAbscondTimer = null }
  abscondingTo     = null
  abscondAction    = null
  largeRoomWarned  = false
  document.body.classList.remove('group-room')
  updatePeerPills()

  if (room) { room.leave(); room = null; sendMsg = null }
  clearAllPeerPings()
  cleanupMedia()
  clearMessages()

  currentRoomId = newRoomName
  activeRoomPassword = null
  updateRoomLock()
  room = joinTrysteroRoom(newRoomName)
  wireRoomHandlers(room, false, true)
  setConnected(newRoomName)
  $return.style.display = ''
  $roomInput.value = newRoomName
  sysMsg(`You absconded from "${originRoomId || 'the room'}". It's just you two now.`)
}

async function returnFromAbscond() {
  const origin = abscondOriginRoom
  isAbscondedRoom   = false
  abscondOriginRoom = null
  $return.style.display = 'none'

  if (room) { room.leave(); room = null; sendMsg = null }
  clearAllPeerPings()
  cleanupMedia()
  clearMessages()

  if (origin) {
    await joinRoomNamed(origin)
    sysMsg(`Returned to "${origin}".`)
  } else {
    setDisconnected()
  }
}

// ── matchmaking ──────────────────────────────────────────────────
// "Random" puts you in a shared lobby room where everyone proposes a private
// room name to whoever they meet. If both sides propose to each other at the
// same time, the lower room name wins (tie-break) so only one side enters —
// the other side will receive the winner's proposal/ack instead.

function _enterLobby() {
  const lobbyPeers = new Set()
  lobbyRoom = joinTrysteroRoom(LOBBY_ID)

  matchTimeout = setTimeout(() => {
    if (!isMatching) return
    matchTimeout = null
    isMatching = false
    if (lobbyRoom) { lobbyRoom.leave(); lobbyRoom = null }
    setDisconnected()
    clearMessages()
    sysMsg('No strangers found. Hit ⚄ Random to try again.')
  }, 30_000)

  const proposeAction = lobbyRoom.makeAction('propose')
  const ackAction     = lobbyRoom.makeAction('ack')

  function tryPropose(peerId) {
    if (proposedTo || !isMatching) return
    proposedRoom = 'match-' + randomHex(16)
    proposedTo   = peerId
    proposeAction.send(proposedRoom, { target: peerId })
  }

  lobbyRoom.onPeerJoin = peerId => {
    if (blockedPeers.has(peerId)) return
    lobbyPeers.add(peerId)
    tryPropose(peerId)
  }

  lobbyRoom.onPeerLeave = peerId => {
    lobbyPeers.delete(peerId)
    if (proposedTo === peerId) {
      proposedTo = null; proposedRoom = null
      for (const p of lobbyPeers) { tryPropose(p); break }
    }
  }

  proposeAction.onMessage = (theirRoom, { peerId }) => {
    if (!isMatching) return
    if (blockedPeers.has(peerId)) return
    if (proposedTo === peerId) {
      // Mutual proposal — tie-break deterministically so only one side enters
      if (theirRoom < proposedRoom) {
        proposedTo = null; proposedRoom = null
        ackAction.send(null, { target: peerId })
        enterPrivateRoom(theirRoom)
      }
      return
    }
    if (proposedTo) return // already proposed elsewhere — ignore
    ackAction.send(null, { target: peerId })
    enterPrivateRoom(theirRoom)
  }

  ackAction.onMessage = (_data, { peerId }) => {
    if (!isMatching) return
    if (peerId === proposedTo && proposedRoom) {
      const roomName = proposedRoom
      proposedTo = null; proposedRoom = null
      enterPrivateRoom(roomName)
    }
  }
}

function enterPrivateRoom(roomName) {
  if (!isMatching) return
  isMatching = false

  if (matchTimeout) { clearTimeout(matchTimeout); matchTimeout = null }
  if (lobbyRoom) { lobbyRoom.leave(); lobbyRoom = null }

  peerNicks = {}
  currentRoomId = null
  isAbscondedRoom = false
  document.body.classList.remove('group-room')
  updatePeerPills()
  room = joinTrysteroRoom(roomName)

  wireRoomHandlers(room, true)

  setMatched()
  sysMsg(`You are ${MY_NICK}.`)
}

function startMatchmaking() {
  if (lobbyRoom || isMatching) return
  if (!vpnCheck()) return
  if (trackerStatus === 'down') {
    sysMsg('⚠ All BitTorrent trackers are unreachable. Matchmaking is unavailable until connectivity is restored.')
    return
  }
  if (matchTimeout) { clearTimeout(matchTimeout); matchTimeout = null }
  if (room) { room.leave(); room = null; sendMsg = null }
  isMatching = true; proposedTo = null; proposedRoom = null
  activeRoomPassword = null
  updateRoomLock()
  clearAllPeerPings()
  cleanupMedia()
  clearMessages()
  setSearching()
  sysMsg('Looking for a stranger… (P2P — may take a moment)')
  _enterLobby()
}

function nextStranger() {
  // Block current peers so we don't immediately re-match with them
  for (const peerId of Object.keys(peerNicks)) blockedPeers.add(peerId)
  if (room) { room.leave(); room = null; sendMsg = null }
  peerNicks = {}
  isMatching = true; proposedTo = null; proposedRoom = null
  clearAllPeerPings()
  cleanupMedia()
  clearMessages()
  setSearching()
  sysMsg('Looking for another stranger…')
  _enterLobby()
}

function stopMatchmaking() {
  if (matchTimeout) { clearTimeout(matchTimeout); matchTimeout = null }
  isMatching = false; proposedTo = null; proposedRoom = null
  if (lobbyRoom) { lobbyRoom.leave(); lobbyRoom = null }
  if (room)      { room.leave();      room = null;     sendMsg = null }
  peerNicks = {}
  clearAllPeerPings()
  cleanupMedia()
  clearMessages()
  setDisconnected()
  sysMsg('Disconnected.')
}

// ── tracker health ───────────────────────────────────────────────
// BitTorrent trackers are how peers find each other. getRelaySockets() only
// returns sockets after the first joinRoom() call (Trystero connects to
// trackers lazily), so monitoring starts the first time we join any room and
// keeps running for the rest of the session — the sockets are shared across
// rooms.

function checkTrackerHealth() {
  const sockets = getRelaySockets()
  const states  = Object.values(sockets).map(s => s?.readyState)
  const total   = states.length

  if (total === 0) {
    trackerStatus = 'unknown'
    $trackerIndicator.style.display = 'none'
    return
  }

  const open = states.filter(s => s === WebSocket.OPEN).length
  $trackerIndicator.style.display = 'inline-block'

  if (open === total) {
    trackerStatus = 'ok'
    $trackerIndicator.textContent = 'TRACKERS: OK'
    $trackerIndicator.className   = 'tracker-ok'
    $trackerIndicator.title       = `${open}/${total} trackers connected`
  } else if (open === 0) {
    trackerStatus = 'down'
    $trackerIndicator.textContent = 'TRACKERS: DOWN'
    $trackerIndicator.className   = 'tracker-down'
    $trackerIndicator.title       = 'No tracker connections — matchmaking unavailable'
  } else {
    trackerStatus = 'warn'
    $trackerIndicator.textContent = `TRACKERS: ${open}/${total}`
    $trackerIndicator.className   = 'tracker-warn'
    $trackerIndicator.title       = `${open}/${total} trackers connected`
  }
}

function startTrackerMonitor() {
  if (trackerPollTimer) return
  checkTrackerHealth()
  trackerPollTimer = setInterval(checkTrackerHealth, 5000)
}

// Trystero derives an AES-GCM key from config.password (if set) and uses it
// to encrypt the SDP exchange — peers with mismatched passwords can't decrypt
// each other's offers/answers, and decryption failures surface here via
// onJoinError.
//
// onJoinError fires on BOTH sides of a failed connection, and which side
// actually gets it is unpredictable (it depends on which peer's SDP decrypt
// happens to run) — it's not a reliable signal for "I was the one rejected",
// and acting on it risks kicking out an innocent existing member with the
// wrong password. So we just log it and stay silent; a rejected newcomer
// (or a lone first-joiner) instead gets the honest "no response" timeout
// message below.
function handleJoinError(details) {
  console.warn('[trystero] join error:', details)
}

// Nicknames are exchanged during the WebRTC handshake itself (before the peer
// is considered "joined"), so by the time onPeerJoin fires, peerNicks[peerId]
// is already populated — no separate "nick" action or deferred reveal needed.
async function exchangeNickHandshake(peerId, send, receive) {
  await send(MY_NICK)
  const { data: nick } = await receive()
  peerNicks[peerId] = nick
}

// Joins a Trystero room and (re)starts tracker health monitoring.
// ROOM_CONFIG sets relayConfig.manualReconnection, so reconnection starts
// paused — resume it here so normal (non-VPN-kill-switch) operation behaves
// like automatic reconnection. The VPN kill switch takes pause/resume from
// here (see triggerVpnKillSwitch / startVpnMonitor).
function joinTrysteroRoom(roomId, password) {
  hasHadPeerJoinThisRoom = false

  const config = password ? { ...ROOM_CONFIG, password } : ROOM_CONFIG
  const r = joinRoom(config, roomId, {
    onJoinError: handleJoinError,
    onPeerHandshake: exchangeNickHandshake,
  })
  resumeRelayReconnection()
  startTrackerMonitor()
  return r
}

// ── settings ─────────────────────────────────────────────────────
// Network interface picker + VPN kill switch. When enabled, a 2s poll
// (startVpnMonitor) checks the chosen interface is still up and force-
// disconnects everything the moment it isn't (triggerVpnKillSwitch).

async function fetchIfaces() {
  cachedIfaces = await window.__electron.getNetworkInterfaces()
}

async function initSettings() {
  const saved = await window.__electron.readSettings().catch(() => ({}))
  selectedInterface = saved.interface    || 'auto'
  vpnProtectionOn   = saved.vpnProtection || false
  await fetchIfaces()
  updateVpnButton()
  updateVpnIndicator()
  if (vpnProtectionOn) {
    vpnBlocked = !isInterfaceUp(selectedInterface)
    startVpnMonitor()
    updateVpnBlockState()
    if (vpnBlocked) sysMsg(`⚠ VPN protection on but ${selectedInterface} is not up — connections blocked.`)
  }
}

async function saveSettings() {
  await window.__electron.writeSettings({ interface: selectedInterface, vpnProtection: vpnProtectionOn }).catch(() => {})
}

async function openSettings() {
  await fetchIfaces()
  refreshIfaceDropdown()
  await refreshDeviceLists()
  $settingsPanel.classList.add('open')
}

function closeSettings() {
  $settingsPanel.classList.remove('open')
}

function refreshIfaceDropdown() {
  const ifaces = cachedIfaces
  $ifaceSelect.innerHTML = '<option value="auto">auto — OS default route</option>'
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue
    const ipv4 = addrs.find(a => a.family === 'IPv4' && !a.internal)
    if (!ipv4) continue
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = `${name}  ${ipv4.address}`
    $ifaceSelect.appendChild(opt)
  }
  // If saved interface isn't currently up, show it as a [down] placeholder so
  // the user can see their saved preference and understand it's unavailable
  const alreadyListed = [...$ifaceSelect.options].some(o => o.value === selectedInterface)
  if (!alreadyListed && selectedInterface !== 'auto') {
    const opt = document.createElement('option')
    opt.value = selectedInterface
    opt.textContent = `${selectedInterface}  [down]`
    $ifaceSelect.appendChild(opt)
  }
  $ifaceSelect.value = selectedInterface
  updateIfaceInfo()
}

function updateIfaceInfo() {
  if (selectedInterface === 'auto') {
    $ifaceInfo.textContent = 'auto — OS handles routing'
    $ifaceInfo.className   = ''
    return
  }
  const ipv4 = cachedIfaces[selectedInterface]?.find(a => a.family === 'IPv4' && !a.internal)
  if (ipv4) {
    $ifaceInfo.textContent = `${selectedInterface}  ${ipv4.address}  ● up`
    $ifaceInfo.className   = 'up'
  } else {
    $ifaceInfo.textContent = `${selectedInterface}  ● down — not found`
    $ifaceInfo.className   = 'down'
  }
}

function isInterfaceUp(name) {
  if (name === 'auto') return true
  return !!(cachedIfaces[name]?.some(a => a.family === 'IPv4' && !a.internal))
}

function vpnCheck() {
  if (!vpnProtectionOn || selectedInterface === 'auto') return true
  if (!isInterfaceUp(selectedInterface)) {
    vpnBlocked = true
    updateVpnBlockState()
    sysMsg(`⚠ ${selectedInterface} is not active. Enable your VPN to connect.`)
    return false
  }
  return true
}

function startVpnMonitor() {
  if (vpnPollTimer) return
  vpnPollTimer = setInterval(async () => {
    if (!vpnProtectionOn || selectedInterface === 'auto') return
    await fetchIfaces()
    const up = isInterfaceUp(selectedInterface)
    updateVpnIndicator()
    if ($settingsPanel.classList.contains('open')) updateIfaceInfo()
    if (!up && !vpnBlocked) {
      vpnBlocked = true
      triggerVpnKillSwitch()
    } else if (up && vpnBlocked) {
      vpnBlocked = false
      resumeRelayReconnection()
      updateVpnBlockState()
      updateVpnIndicator()
      sysMsg(`${selectedInterface} is back up. You may reconnect.`)
    }
  }, 2000)
}

function stopVpnMonitor() {
  if (vpnPollTimer) { clearInterval(vpnPollTimer); vpnPollTimer = null }
}

function triggerVpnKillSwitch() {
  disconnectAll()
  pauseRelayReconnection()
  clearMessages()
  sysMsg(`⚠  VPN DISCONNECTED — ${selectedInterface} went down.`)
  sysMsg('All connections killed to protect your IP.')
  sysMsg('Reconnect your VPN, then hit ⚄ Random to continue.')
  updateVpnBlockState()
  updateVpnIndicator()
}

// Hard disconnect from any state (lobby, named room, private room)
function disconnectAll() {
  if (matchTimeout) { clearTimeout(matchTimeout); matchTimeout = null }
  if (lobbyRoom) { lobbyRoom.leave(); lobbyRoom = null }
  if (room)      { room.leave();      room = null;      sendMsg = null }
  isMatching = false; proposedTo = null; proposedRoom = null
  peerNicks  = {}
  largeRoomWarned = false
  resetAbscondState()
  cleanupMedia()
  setDisconnected()
}

function updateVpnBlockState() {
  const blocked = vpnProtectionOn && vpnBlocked
  $join.disabled   = blocked
  $random.disabled = blocked
  const tip = blocked ? `${selectedInterface} is down — enable your VPN first` : ''
  $join.title   = tip
  $random.title = tip
}

function updateVpnButton() {
  $btnVpn.textContent = vpnProtectionOn ? 'ON' : 'OFF'
  $btnVpn.className   = 'media-btn' + (vpnProtectionOn ? ' on' : '')
}

function updateVpnIndicator() {
  if (!vpnProtectionOn || selectedInterface === 'auto') {
    $vpnIndicator.style.display = 'none'
    return
  }
  $vpnIndicator.style.display = ''
  if (isInterfaceUp(selectedInterface)) {
    $vpnIndicator.style.color = 'var(--green)'
    $vpnIndicator.title = `VPN: ${selectedInterface} active`
  } else {
    $vpnIndicator.style.color = 'var(--danger)'
    $vpnIndicator.title = `VPN: ${selectedInterface} DOWN`
  }
}

async function onIfaceChange() {
  selectedInterface = $ifaceSelect.value
  updateIfaceInfo()
  updateVpnIndicator()
  updateVpnBlockState()
  await saveSettings()
}

async function onVpnToggle() {
  vpnProtectionOn = !vpnProtectionOn
  if (vpnProtectionOn) {
    await fetchIfaces()
    vpnBlocked = !isInterfaceUp(selectedInterface)
    startVpnMonitor()
    if (selectedInterface === 'auto') {
      sysMsg('VPN kill switch on (no interface selected — monitoring disabled).')
    } else if (vpnBlocked) {
      sysMsg(`VPN kill switch on. ${selectedInterface} is DOWN — connections blocked.`)
    } else {
      sysMsg(`VPN kill switch on. Monitoring ${selectedInterface}.`)
    }
  } else {
    vpnBlocked = false
    stopVpnMonitor()
    sysMsg('VPN kill switch off.')
  }
  updateVpnButton()
  updateVpnBlockState()
  updateVpnIndicator()
  await saveSettings()
}

// ── copy room name ────────────────────────────────────────────────
// Lets the user share the current room name with someone else (e.g. via a
// different chat app) so they can join with "Join" instead of Random.

async function copyRoomName() {
  const name = $roomInput.value
  if (!name) return
  await navigator.clipboard.writeText(name)
  $copy.textContent = 'copied!'
  $copy.classList.add('copied')
  setTimeout(() => { $copy.textContent = 'copy'; $copy.classList.remove('copied') }, 1500)
  sysMsg('Room name copied. Share the password separately if set.')
}

// ── send ─────────────────────────────────────────────────────────

function send() {
  const body = $input.value.trim()
  if (!body || !sendMsg) return
  sendMsg(body)
  chatMsg(MY_NICK, body, true)
  $input.value = ''
}

// ── events ───────────────────────────────────────────────────────
// Wires every button/select/input above to the functions defined earlier.

$join.addEventListener('click',   () => { if ($roomInput.value.trim()) joinRoomNamed($roomInput.value) })
$copy.addEventListener('click',   copyRoomName)
$random.addEventListener('click', startMatchmaking)
$next.addEventListener('click',   nextStranger)
$stop.addEventListener('click',   stopMatchmaking)
$leave.addEventListener('click',  leaveRoom)
$return.addEventListener('click', returnFromAbscond)
$send.addEventListener('click',   send)

$btnMic.addEventListener('click', toggleMic)
$btnCam.addEventListener('click', toggleCam)
$btnEar.addEventListener('click', toggleEar)
$btnEye.addEventListener('click', toggleEye)
$btnFile.addEventListener('click', toggleFile)

$btnAttach.addEventListener('click', () => $fileInput.click())
$fileInput.addEventListener('change', onFileSelected)

// ── drag-and-drop file sending ──────────────────────────────────────
// Dropping files anywhere on the message area sends them the same way as
// the 📎 picker. A counter (rather than dragenter/dragleave alone) avoids
// the overlay flickering as the drag passes over child elements.
let dragCounter = 0

$msgs.addEventListener('dragenter', e => {
  e.preventDefault()
  dragCounter++
  $dropZone.classList.add('show')
})

$msgs.addEventListener('dragover', e => e.preventDefault())

$msgs.addEventListener('dragleave', e => {
  e.preventDefault()
  dragCounter = Math.max(0, dragCounter - 1)
  if (dragCounter === 0) $dropZone.classList.remove('show')
})

$msgs.addEventListener('drop', e => {
  e.preventDefault()
  dragCounter = 0
  $dropZone.classList.remove('show')
  const files = Array.from(e.dataTransfer?.files || [])
  if (files.length) sendFiles(files)
})

$btnSettings.addEventListener('click',      openSettings)
$btnSettingsClose.addEventListener('click',  closeSettings)
$ifaceSelect.addEventListener('change',      onIfaceChange)
$btnVpn.addEventListener('click',            onVpnToggle)
$micSelect.addEventListener('change',        onMicSelectChange)
$camSelect.addEventListener('change',        onCamSelectChange)
navigator.mediaDevices.ondevicechange = handleDeviceChange

$input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
})
$roomInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && $roomInput.value.trim()) joinRoomNamed($roomInput.value)
})
$roomInput.addEventListener('input', updateRoomPassVisibility)
$roomPass.addEventListener('keydown', e => {
  if (e.key === 'Enter' && $roomInput.value.trim()) joinRoomNamed($roomInput.value)
})

// ── boot ─────────────────────────────────────────────────────────
// Load saved settings (interface/VPN preference) and show the initial
// welcome messages. The app starts disconnected — see index.html for the
// initial DOM state.

initSettings()
sysMsg('Welcome to Narciso. Enter a room name or hit ⚄ Random.')
sysMsg('Connect quietly.')
