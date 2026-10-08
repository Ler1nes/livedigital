import { toast, initials, colorOf, copyText, roomLink } from './ui.js';

const $ = s => document.querySelector(s);

const params = new URLSearchParams(location.search);
const roomId = (params.get('room') || '').trim();
const roomNameParam = params.get('n') || '';

if (!roomId) {
  document.body.innerHTML =
    '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px">' +
    '<div><h2>Не указана комната</h2>' +
    '<p style="color:#8b93a7">Ссылка должна выглядеть как room.html?room=КОД</p>' +
    '<a class="btn btn-primary" href="index.html">На главную</a></div></div>';
  throw new Error('нет параметра room');
}

const LS_ROOMS = 'lr_rooms';
const LS_NAME = 'lr_name';
const LS_DEVICES = 'lr_devices';
const TRYSTERO_URLS = ['https://esm.run/trystero', 'https://esm.sh/trystero'];

// ---------- DOM ----------
const lobby = $('#lobby');
const call = $('#call');
const lobbyVideo = $('#lobbyVideo');
const lobbyAvatar = $('#lobbyAvatar');
const lobbyError = $('#lobbyError');
const nameInput = $('#nameInput');
const lobbyMicBtn = $('#lobbyMicBtn');
const lobbyCamBtn = $('#lobbyCamBtn');
const joinCallBtn = $('#joinCallBtn');
const lobbyRoomTitle = $('#lobbyRoomTitle');
const lobbyRoomCode = $('#lobbyRoomCode');

const callRoomName = $('#callRoomName');
const peerCountEl = $('#peerCount');
const copyLinkBtn = $('#copyLinkBtn');
const grid = $('#grid');
const stage = document.querySelector('.stage');
const presentation = $('#presentation');
const callBody = $('.call-body');
const screensGrid = $('#screensGrid');
const screensFocus = $('#screensFocus');
const focusMain = $('#focusMain');
const focusVideo = $('#focusVideo');
const focusTitle = $('#focusTitle');
const focusStrip = $('#focusStrip');
const focusCloseBtn = $('#focusCloseBtn');

const chatPanel = $('#chatPanel');
const chatBtn = $('#chatBtn');
const chatCloseBtn = $('#chatCloseBtn');
const chatMessages = $('#chatMessages');
const chatForm = $('#chatForm');
const chatInput = $('#chatInput');
const chatImageBtn = $('#chatImageBtn');
const chatImageInput = $('#chatImageInput');

const micBtn = $('#micBtn');
const camBtn = $('#camBtn');
const screenBtn = $('#screenBtn');
const handBtn = $('#handBtn');
const settingsCallBtn = $('#settingsCallBtn');
const leaveBtn = $('#leaveBtn');

const settingsLobbyBtn = $('#settingsLobbyBtn');
const settingsModal = $('#settingsModal');
const settingsCloseBtn = $('#settingsCloseBtn');
const micSelect = $('#micSelect');
const camSelect = $('#camSelect');
const spkSelect = $('#spkSelect');
const settingsMeter = $('#settingsMeter');
const micGainEl = $('#micGain');
const micGainVal = $('#micGainVal');
const testSoundBtn = $('#testSoundBtn');
const devicesHint = $('#devicesHint');

const micFillEls = [
  lobbyMicBtn.querySelector('.mic-fill'),
  micBtn.querySelector('.mic-fill')
].filter(Boolean);

// ---------- state ----------
let T = null;
let room = null;
let selfId = 'self';
let stateAction = null;
let chatAction = null;
let ctrlAction = null;

let localStream = null;
let screenStream = null;
let camTrack = null;
let micTrack = null;

const myState = { name: '', micOn: true, camOn: true, hand: false, screenOn: false, gain: 1 };
const peers = new Map();
const screens = new Map();
const chatHistory = [];
let focusedScreenId = null;
let screensSig = '';
let stripSig = '';

let audioCtx = null;
let localGraph = null;

const prefs = { mic: '', cam: '', spk: '', gain: 1 };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(LS_DEVICES) || '{}')); } catch {}
function savePrefs() {
  try { localStorage.setItem(LS_DEVICES, JSON.stringify(prefs)); } catch {}
}
myState.gain = Number.isFinite(Number(prefs.gain)) ? Math.max(0, Number(prefs.gain)) : 1;

const defaultPeerState = () => ({ name: '', micOn: true, camOn: false, hand: false, screenOn: false, gain: 1 });

// ---------- rooms / misc ----------
function resolveRoomName() {
  let rooms = [];
  try { rooms = JSON.parse(localStorage.getItem(LS_ROOMS)) || []; } catch {}
  const saved = rooms.find(r => r.id === roomId);
  const name = roomNameParam || (saved && saved.name) || ('Комната ' + roomId);
  if (!saved) rooms.unshift({ id: roomId, name, created: Date.now() });
  else if (roomNameParam) saved.name = roomNameParam;
  try { localStorage.setItem(LS_ROOMS, JSON.stringify(rooms.slice(0, 100))); } catch {}
  return name;
}

const roomName = resolveRoomName();
document.title = 'LiveRoom — ' + roomName;
lobbyRoomTitle.textContent = roomName;
lobbyRoomCode.textContent = 'код: ' + roomId;
callRoomName.textContent = roomName;

async function loadTrystero() {
  if (T) return T;
  let lastErr;
  for (const url of TRYSTERO_URLS) {
    try {
      T = await import(url);
      if (T.joinRoom) return T;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('P2P library failed to load');
}

function layout() {
  const n = peers.size + 1;
  const cols = n === 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  grid.style.setProperty('--cols', cols);
  peerCountEl.textContent = n;
}

function updateControls() {
  const micOff = !myState.micOn;
  const camOff = !myState.camOn;
  lobbyMicBtn.classList.toggle('off', micOff);
  lobbyCamBtn.classList.toggle('off', camOff);
  micBtn.classList.toggle('off', micOff);
  camBtn.classList.toggle('off', camOff);
  screenBtn.classList.toggle('active', myState.screenOn);
  handBtn.classList.toggle('active', myState.hand);
  chatBtn.classList.toggle('active', !chatPanel.hidden);

  lobbyVideo.hidden = camOff;
  lobbyAvatar.hidden = !camOff;
  lobbyAvatar.textContent = initials(myState.name || nameInput.value || '?');
  lobbyAvatar.style.background = colorOf(roomId + (myState.name || ''));

  const selfTile = grid.querySelector('.tile.self');
  if (selfTile) applyStateToTile(selfTile, myState, selfId);
}

function broadcast() {
  if (room && stateAction) {
    Promise.resolve(stateAction.send({ ...myState })).catch(() => {});
  }
}

function applyStateToTile(tile, st, id) {
  const v = tile.querySelector('video');
  const av = tile.querySelector('.avatar');
  const nm = tile.querySelector('.nm');
  const micOff = tile.querySelector('.mic-off');
  const meter = tile.querySelector('.tile-meter');
  const camOff = !st.camOn;
  v.hidden = camOff;
  av.hidden = !camOff;
  if (!camOff) v.play().catch(() => {});
  const label = st.name || 'Участник…';
  if (nm.textContent !== label) nm.textContent = label;
  av.textContent = initials(st.name || id);
  av.style.background = colorOf(id);
  micOff.hidden = !!st.micOn;
  if (meter) meter.hidden = !st.micOn;
  tile.classList.toggle('hand-raised', !!st.hand);
}

// ---------- audio ----------
function ensureAudioCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { audioCtx = new AC(); } catch { return null; }
    if (prefs.spk && typeof audioCtx.setSinkId === 'function') {
      audioCtx.setSinkId(prefs.spk).catch(() => {});
    }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

document.addEventListener('pointerdown', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
});

function attachLocalAnalyser() {
  if (!localStream || !localStream.getAudioTracks().length) return;
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  if (localGraph) {
    try { localGraph.src.disconnect(); } catch {}
    localGraph = null;
  }
  try {
    const src = ctx.createMediaStreamSource(localStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    localGraph = { src, analyser, data: new Float32Array(analyser.fftSize) };
  } catch {}
}

function attachPeerAudio(id, stream) {
  const p = peers.get(id);
  if (!p) return;
  if (p.graph) {
    try { p.graph.src.disconnect(); p.graph.gain.disconnect(); } catch {}
    p.graph = null;
  }
  if (p.audioEl) {
    p.audioEl.pause();
    p.audioEl.srcObject = null;
    p.audioEl = null;
  }
  if (!stream.getAudioTracks().length) return;

  const ctx = ensureAudioCtx();
  if (ctx) {
    try {
      const src = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = peerGain(p);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(gain);
      gain.connect(ctx.destination);
      src.connect(analyser);
      p.graph = { src, gain, analyser, data: new Float32Array(analyser.fftSize) };
      return;
    } catch {}
  }
  try {
    const a = new Audio();
    a.autoplay = true;
    a.srcObject = stream;
    a.volume = Math.min(1, p.volume);
    a.play().catch(() => {});
    p.audioEl = a;
  } catch {}
}

function peerGain(p) {
  const raw = p.state ? Number(p.state.gain) : 1;
  const remote = Number.isFinite(raw) ? raw : 1;
  return Math.max(0, Math.min(4, (p.volume || 1) * remote));
}

function applyVolume(p) {
  if (p.graph && audioCtx) {
    try { p.graph.gain.gain.setTargetAtTime(peerGain(p), audioCtx.currentTime, 0.02); } catch {}
  } else if (p.audioEl) {
    p.audioEl.volume = Math.min(1, peerGain(p));
  }
}

function rmsOf(analyser, data) {
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

function tick() {
  const now = Date.now();
  let selfLvl = 0;
  if (localGraph && audioCtx && audioCtx.state === 'running') {
    try { selfLvl = Math.min(1, rmsOf(localGraph.analyser, localGraph.data) * 5); } catch {}
  }
  if (!myState.micOn) selfLvl = 0;
  for (const el of micFillEls) el.style.height = (selfLvl * 100).toFixed(0) + '%';
  if (settingsMeter) settingsMeter.style.width = (selfLvl * 100).toFixed(0) + '%';

  const selfTile = grid.querySelector('.tile.self');
  if (selfTile) {
    const fill = selfTile.querySelector('.tile-meter i');
    if (fill) fill.style.height = (selfLvl * 100).toFixed(0) + '%';
  }

  for (const [id, p] of peers) {
    if (!p.tile) continue;
    let raw = 0;
    if (p.graph && audioCtx && audioCtx.state === 'running') {
      try { raw = Math.min(1, rmsOf(p.graph.analyser, p.graph.data) * 5); } catch {}
    }
    p.fill = (p.fill || 0) * 0.55 + raw * 0.45;
    if (p.meterFill) p.meterFill.style.height = (p.fill * 100).toFixed(0) + '%';
    p.smooth = (p.smooth || 0) * 0.8 + raw * 0.2;
    if (p.smooth > 0.06) p.lastSpoke = now;
    const speaking = !!p.lastSpoke && now - p.lastSpoke < 700;
    if (p.speaking !== speaking) {
      p.speaking = speaking;
      p.tile.classList.toggle('speaking', speaking);
    }
  }
  requestAnimationFrame(tick);
}

// ---------- lobby media ----------
function mediaConstraints() {
  const audio = prefs.mic ? { deviceId: { exact: prefs.mic } } : true;
  const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
  if (prefs.cam) video.deviceId = { exact: prefs.cam };
  return { audio, video };
}

async function initPreview() {
  const stream = new MediaStream();
  try {
    const a = await navigator.mediaDevices.getUserMedia({ audio: mediaConstraints().audio });
    micTrack = a.getAudioTracks()[0];
    stream.addTrack(micTrack);
  } catch {}
  try {
    const v = await navigator.mediaDevices.getUserMedia({ video: mediaConstraints().video });
    camTrack = v.getVideoTracks()[0];
    stream.addTrack(camTrack);
  } catch {}

  if (stream.getTracks().length) {
    localStream = stream;
    lobbyVideo.srcObject = localStream;
    lobbyVideo.play().catch(() => {});
  } else {
    myState.camOn = false;
    myState.micOn = false;
    lobbyError.textContent = 'Нет доступа к камере и микрофону — можно войти без них';
    lobbyError.hidden = false;
  }
  if (!micTrack) myState.micOn = false;
  if (!camTrack) myState.camOn = false;
  attachLocalAnalyser();
  updateControls();
}

async function setMic(on) {
  if (on && !micTrack) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: mediaConstraints().audio });
      micTrack = s.getAudioTracks()[0];
      if (!localStream) localStream = new MediaStream();
      localStream.addTrack(micTrack);
      if (room) { try { room.addTrack(micTrack, localStream); } catch {} }
      refreshLocalVideos();
      attachLocalAnalyser();
    } catch {
      toast('Нет доступа к микрофону');
    }
  }
  if (micTrack) micTrack.enabled = on;
  myState.micOn = !!micTrack && on;
  updateControls();
  broadcast();
}

async function setCam(on) {
  if (on && !camTrack) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: mediaConstraints().video });
      camTrack = s.getVideoTracks()[0];
      if (!localStream) localStream = new MediaStream();
      localStream.addTrack(camTrack);
      if (room) { try { room.addTrack(camTrack, localStream); } catch {} }
      refreshLocalVideos();
    } catch {
      toast('Нет доступа к камере');
    }
  }
  if (camTrack) camTrack.enabled = on;
  myState.camOn = !!camTrack && on;
  updateControls();
  broadcast();
}

function refreshLocalVideos() {
  if (localStream) {
    if (!lobby.hidden) {
      lobbyVideo.srcObject = localStream;
      lobbyVideo.play().catch(() => {});
    }
    const selfV = grid.querySelector('.tile.self video');
    if (selfV) {
      selfV.srcObject = localStream;
      selfV.play().catch(() => {});
    }
  }
}

// ---------- tiles ----------
function buildTile(id, isSelf) {
  const tile = document.createElement('div');
  tile.className = 'tile' + (isSelf ? ' self' : '');
  tile.dataset.peer = id;

  const v = document.createElement('video');
  v.autoplay = true;
  v.playsInline = true;
  v.muted = true;
  if (isSelf && localStream) {
    v.srcObject = localStream;
    v.play().catch(() => {});
  }

  const av = document.createElement('div');
  av.className = 'avatar';

  const hand = document.createElement('div');
  hand.className = 'hand-badge';
  hand.textContent = '✋';

  const nmWrap = document.createElement('div');
  nmWrap.className = 'tile-name';
  const nm = document.createElement('span');
  nm.className = 'nm';
  const meter = document.createElement('span');
  meter.className = 'tile-meter';
  const meterFill = document.createElement('i');
  meter.appendChild(meterFill);
  const micOff = document.createElement('span');
  micOff.className = 'mic-off';
  micOff.textContent = '🔇';
  nmWrap.append(nm, meter, micOff);

  tile.append(v, av, hand, nmWrap);
  return { tile, meterFill };
}

function ensureTile(id) {
  let p = peers.get(id);
  if (!p) {
    p = {
      state: defaultPeerState(), camStream: null, screenStream: null,
      tile: null, audioEl: null, graph: null, meterFill: null,
      volume: 1, fill: 0, smooth: 0, lastSpoke: 0, speaking: false
    };
    peers.set(id, p);
  }
  if (!p.tile) {
    const { tile, meterFill } = buildTile(id, false);
    p.tile = tile;
    p.meterFill = meterFill;

    const vol = document.createElement('div');
    vol.className = 'tile-vol';
    const volIc = document.createElement('span');
    volIc.textContent = '🔊';
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '200';
    range.value = '100';
    const volVal = document.createElement('span');
    volVal.className = 'vol-val';
    volVal.textContent = '100%';
    range.addEventListener('input', () => {
      p.volume = Number(range.value) / 100;
      volVal.textContent = range.value + '%';
      applyVolume(p);
    });
    const muteBtn = document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.className = 'tile-mute';
    muteBtn.textContent = '🔇';
    muteBtn.title = 'Выключить / включить микрофон участника';
    muteBtn.addEventListener('click', e => {
      e.stopPropagation();
      const on = !p.state.micOn;
      sendCtrl(id, { type: 'mute', on });
      toast(on ? 'Запрос: включить микрофон' : 'Запрос: выключить микрофон');
    });
    vol.append(volIc, range, volVal, muteBtn);
    tile.appendChild(vol);

    grid.appendChild(tile);
    applyStateToTile(tile, p.state, id);
  }
  return p;
}

function addSelfTile() {
  if (grid.querySelector('.tile.self')) return;
  const { tile } = buildTile(selfId, true);
  grid.prepend(tile);
  applyStateToTile(tile, myState, selfId);
}

// ---------- presentation (all screens) ----------
function screenLabel(id) {
  if (id === selfId) return 'Вы';
  const p = peers.get(id);
  return (p && p.state && p.state.name) || 'Участник';
}

function renderPresentation() {
  if (!screens.size) {
    presentation.hidden = true;
    stage.classList.remove('has-screen');
    focusedScreenId = null;
    screensSig = '';
    stripSig = '';
    screensGrid.innerHTML = '';
    focusStrip.innerHTML = '';
    focusVideo.srcObject = null;
    return;
  }
  presentation.hidden = false;
  stage.classList.add('has-screen');
  if (focusedScreenId && !screens.has(focusedScreenId)) focusedScreenId = null;
  if (focusedScreenId) renderFocus();
  else renderGrid();
}

function renderGrid() {
  screensFocus.hidden = true;
  screensGrid.hidden = false;
  const sig = [...screens.keys()].sort().join(',');
  if (sig !== screensSig) {
    screensSig = sig;
    stripSig = '';
    screensGrid.innerHTML = '';
    for (const [id, stream] of screens) {
      const tile = document.createElement('div');
      tile.className = 'screen-tile';
      tile.dataset.id = id;
      const v = document.createElement('video');
      v.autoplay = true;
      v.playsInline = true;
      v.muted = true;
      v.srcObject = stream;
      v.play().catch(() => {});
      const lab = document.createElement('div');
      lab.className = 'pres-label';
      const dot = document.createElement('span');
      dot.className = 'dot';
      const title = document.createElement('span');
      title.className = 'st-title';
      lab.append(dot, title);
      tile.append(v, lab);
      tile.addEventListener('click', () => {
        focusedScreenId = id;
        renderPresentation();
      });
      screensGrid.appendChild(tile);
    }
  }
  for (const tile of screensGrid.children) {
    const title = tile.querySelector('.st-title');
    const txt = 'Экран: ' + screenLabel(tile.dataset.id);
    if (title.textContent !== txt) title.textContent = txt;
  }
}

function renderFocus() {
  screensGrid.hidden = true;
  screensFocus.hidden = false;
  const stream = screens.get(focusedScreenId);
  if (focusVideo.srcObject !== stream) {
    focusVideo.srcObject = stream;
    focusVideo.play().catch(() => {});
  }
  // ensure no vertical overflow in top containers when focused
  if (stage) stage.style.overflow = 'hidden';
  if (presentation) presentation.style.overflow = 'hidden';
  if (screensFocus) screensFocus.style.overflow = 'hidden';
  if (callBody) callBody.style.overflow = 'hidden';

  const others = [...screens.keys()].filter(id => id !== focusedScreenId).sort();
  focusStrip.hidden = others.length === 0;
  const sig = others.join(',');
  if (sig !== stripSig) {
    stripSig = sig;
    focusStrip.innerHTML = '';
    for (const id of others) {
      const item = document.createElement('div');
      item.className = 'strip-item';
      item.dataset.id = id;
      const v = document.createElement('video');
      v.autoplay = true;
      v.playsInline = true;
      v.muted = true;
      v.srcObject = screens.get(id);
      v.play().catch(() => {});
      const lab = document.createElement('span');
      lab.className = 'strip-label';
      lab.textContent = screenLabel(id);
      item.append(v, lab);
      item.addEventListener('click', e => {
        e.stopPropagation();
        focusedScreenId = id;
        renderPresentation();
      });
      focusStrip.appendChild(item);
    }
  } else {
    for (const item of focusStrip.children) {
      const lab = item.querySelector('.strip-label');
      const txt = screenLabel(item.dataset.id);
      if (lab.textContent !== txt) lab.textContent = txt;
    }
  }
}

// ---------- peers ----------
function onPeerJoin(id) {
  ensureTile(id);
  syncTo(id);
  layout();
}

function syncTo(id) {
  if (!room) return;
  try {
    if (localStream && localStream.getTracks().length) {
      Promise.resolve(room.addStream(localStream, { target: id })).catch(() => {});
    }
    if (screenStream) {
      Promise.resolve(
        room.addStream(screenStream, { target: id, metadata: { kind: 'screen' } })
      ).catch(() => {});
    }
    if (stateAction) Promise.resolve(stateAction.send({ ...myState }, { target: id })).catch(() => {});
    if (chatAction && chatHistory.length) {
      Promise.resolve(chatAction.send(chatHistory.slice(), { target: id })).catch(() => {});
    }
  } catch {}
}

function onPeerLeave(id) {
  const p = peers.get(id);
  if (p) {
    if (p.tile) p.tile.remove();
    if (p.graph) { try { p.graph.src.disconnect(); p.graph.gain.disconnect(); } catch {} }
    if (p.audioEl) { p.audioEl.pause(); p.audioEl.srcObject = null; }
    peers.delete(id);
  }
  screens.delete(id);
  if (focusedScreenId === id) focusedScreenId = null;
  renderPresentation();
  layout();
}

function onPeerStream(stream, peerId, meta) {
  const p = ensureTile(peerId);
  if (meta && meta.kind === 'screen') {
    p.screenStream = stream;
    screens.set(peerId, stream);
    renderPresentation();
    return;
  }
  p.camStream = stream;
  const v = p.tile.querySelector('video');
  if (v.srcObject !== stream) v.srcObject = stream;
  v.play().catch(() => {});
  attachPeerAudio(peerId, stream);
  applyStateToTile(p.tile, p.state, peerId);
}

function onCtrl(peerId, data) {
  if (!data || typeof data !== 'object') return;
  if (data.type === 'mute') {
    const on = !!data.on;
    setMic(on);
    toast(on ? 'Ваш микрофон включён модератором' : 'Ваш микрофон выключен модератором');
  }
}

function sendCtrl(peerId, msg) {
  if (!ctrlAction) { toast('Нет соединения'); return; }
  Promise.resolve(ctrlAction.send(msg, { target: peerId })).catch(() => {});
}

function onPeerState(peerId, data) {
  if (!data || typeof data !== 'object') return;
  const p = ensureTile(peerId);
  const prev = p.state || defaultPeerState();
  p.state = {
    name: typeof data.name === 'string' ? data.name.slice(0, 40) : prev.name,
    micOn: typeof data.micOn === 'boolean' ? data.micOn : prev.micOn,
    camOn: typeof data.camOn === 'boolean' ? data.camOn : prev.camOn,
    hand: typeof data.hand === 'boolean' ? data.hand : prev.hand,
    screenOn: typeof data.screenOn === 'boolean' ? data.screenOn : prev.screenOn,
    gain: Number.isFinite(Number(data.gain)) ? Math.max(0, Number(data.gain)) : prev.gain
  };
  applyStateToTile(p.tile, p.state, peerId);
  applyVolume(p);
  if (!p.state.screenOn && screens.has(peerId)) {
    screens.delete(peerId);
    if (focusedScreenId === peerId) focusedScreenId = null;
    renderPresentation();
  } else if (screens.size) {
    renderPresentation();
  }
}

// ---------- screen share ----------
async function toggleScreen() {
  if (screenStream) { stopScreen(); return; }
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 15 },
      audio: false
    });
  } catch {
    return;
  }
  const track = screenStream.getVideoTracks()[0];
  track.onended = () => stopScreen();
  myState.screenOn = true;
  screens.set(selfId, screenStream);
  if (room) {
    Promise.resolve(
      room.addStream(screenStream, { metadata: { kind: 'screen' } })
    ).catch(() => {});
  }
  renderPresentation();
  updateControls();
  broadcast();
}

function stopScreen() {
  if (!screenStream) return;
  const s = screenStream;
  screenStream = null;
  s.getTracks().forEach(t => { try { t.stop(); } catch {} });
  if (room) { try { room.removeStream(s); } catch {} }
  myState.screenOn = false;
  screens.delete(selfId);
  if (focusedScreenId === selfId) focusedScreenId = null;
  renderPresentation();
  updateControls();
  broadcast();
}

// ---------- chat ----------
function ingestMessages(data) {
  const list = Array.isArray(data) ? data : [data];
  for (const m of list) {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string') continue;
    if (chatHistory.some(x => x.id === m.id)) continue;
    chatHistory.push(m);
    renderMsg(m);
  }
  if (chatHistory.length > 300) chatHistory.splice(0, chatHistory.length - 300);
}

chatForm.addEventListener('submit', e => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !chatAction) return;
  chatInput.value = '';
  sendTextMsg(text);
});

chatImageBtn.addEventListener('click', () => {
  if (!chatAction) { toast('Чат недоступен'); return; }
  chatImageInput.click();
});
chatImageInput.addEventListener('change', e => {
  const files = Array.from(e.target.files || []);
  for (const f of files) sendImageMsg(f);
  chatImageInput.value = '';
});

window.addEventListener('paste', e => {
  if (chatPanel.hidden) return;
  const items = e.clipboardData && e.clipboardData.items;
  if (items && items.length) {
    handleImageDataTransfer(items);
  }
});

chatMessages.addEventListener('dragover', e => { e.preventDefault(); });
chatMessages.addEventListener('drop', e => {
  e.preventDefault();
  const dt = e.dataTransfer;
  const items = dt && dt.items;
  if (items && items.length) { handleImageDataTransfer(items); return; }
  const files = dt && dt.files;
  if (files && files.length) {
    for (const f of files) if (f.type.startsWith('image/')) sendImageMsg(f);
  }
});

chatPanel.addEventListener('dragover', e => { e.preventDefault(); });
chatPanel.addEventListener('drop', e => {
  e.preventDefault();
  const dt = e.dataTransfer;
  const items = dt && dt.items;
  if (items && items.length) { handleImageDataTransfer(items); return; }
  const files = dt && dt.files;
  if (files && files.length) {
    for (const f of files) if (f.type.startsWith('image/')) sendImageMsg(f);
  }
});

function handleImageDataTransfer(items) {
  for (const it of items || []) {
    if (it.kind === 'file') {
      const file = it.getAsFile();
      if (file && file.type.startsWith('image/')) sendImageMsg(file);
    }
  }
}

function toggleChat(force) {
  const open = typeof force === 'boolean' ? force : chatPanel.hidden;
  chatPanel.hidden = !open;
  updateControls();
  if (open) chatInput.focus();
}

// ---------- settings ----------
function fillSelect(sel, devices, kind, current, defLabel) {
  sel.innerHTML = '';
  const def = document.createElement('option');
  def.value = '';
  def.textContent = defLabel;
  sel.appendChild(def);
  const list = devices.filter(d => d.kind === kind);
  list.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || ((kind === 'audioinput' ? 'Микрофон ' : kind === 'videoinput' ? 'Камера ' : 'Устройство ') + (i + 1));
    sel.appendChild(o);
  });
  const valid = current && [...sel.options].some(o => o.value === current);
  sel.value = valid ? current : '';
}

async function openSettings() {
  settingsModal.hidden = false;
  try { await previewPromise; } catch {}
  let devices = [];
  try { devices = await navigator.mediaDevices.enumerateDevices(); } catch {}
  fillSelect(micSelect, devices, 'audioinput', prefs.mic, 'Системный микрофон');
  fillSelect(camSelect, devices, 'videoinput', prefs.cam, 'Системная камера');
  fillSelect(spkSelect, devices, 'audiooutput', prefs.spk, 'Устройство по умолчанию');
  if (micGainEl) {
    const pct = Math.round((myState.gain || 0) * 100);
    micGainEl.value = String(pct);
    if (micGainVal) micGainVal.textContent = pct + '%';
  }
  const anyDevice = micSelect.options.length > 1 || camSelect.options.length > 1 || spkSelect.options.length > 1;
  devicesHint.hidden = anyDevice;
}

function closeSettings() {
  settingsModal.hidden = true;
}

async function switchMic(deviceId) {
  prefs.mic = deviceId;
  savePrefs();
  if (!micTrack) return;
  try {
    await micTrack.applyConstraints(deviceId ? { deviceId: { exact: deviceId } } : {});
  } catch {
    toast('Не удалось переключить микрофон');
  }
}

async function switchCam(deviceId) {
  prefs.cam = deviceId;
  savePrefs();
  if (!camTrack) return;
  try {
    const c = { width: { ideal: 1280 }, height: { ideal: 720 } };
    if (deviceId) c.deviceId = { exact: deviceId };
    await camTrack.applyConstraints(c);
  } catch {
    toast('Не удалось переключить камеру');
  }
}

async function switchSpeaker(deviceId) {
  prefs.spk = deviceId;
  savePrefs();
  if (!deviceId) return;
  const ctx = ensureAudioCtx();
  if (ctx && typeof ctx.setSinkId === 'function') {
    try {
      await ctx.setSinkId(deviceId);
      toast('Устройство вывода изменено');
    } catch {
      toast('Не удалось переключить устройство вывода');
    }
  } else {
    toast('Этот браузер не поддерживает выбор устройства вывода');
  }
}

function testSound() {
  const ctx = ensureAudioCtx();
  if (!ctx) { toast('Аудио недоступно'); return; }
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  g.gain.value = 0.15;
  osc.frequency.value = 440;
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.6);
  toast('Прозвучал тестовый тон');
}

settingsLobbyBtn.addEventListener('click', openSettings);
settingsCallBtn.addEventListener('click', openSettings);
settingsCloseBtn.addEventListener('click', closeSettings);
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) closeSettings(); });
micSelect.addEventListener('change', () => switchMic(micSelect.value));
camSelect.addEventListener('change', () => switchCam(camSelect.value));
spkSelect.addEventListener('change', () => switchSpeaker(spkSelect.value));
testSoundBtn.addEventListener('click', testSound);
if (micGainEl) {
  micGainEl.addEventListener('input', () => {
    myState.gain = Number(micGainEl.value) / 100;
    if (micGainVal) micGainVal.textContent = micGainEl.value + '%';
    prefs.gain = myState.gain;
    savePrefs();
    broadcast();
  });
}

// ---------- join / leave ----------
async function joinCall() {
  myState.name = nameInput.value.trim() || 'Участник';
  try { localStorage.setItem(LS_NAME, myState.name); } catch {}
  joinCallBtn.disabled = true;
  joinCallBtn.textContent = 'Подключение…';
  ensureAudioCtx();

  try {
    T = await loadTrystero();
    selfId = T.selfId;
    room = T.joinRoom({ appId: 'livedigital-rooms-v1' }, roomId, {
      onJoinError: details => {
        const msg = details && details.error && details.error.message;
        toast('Не удалось подключиться' + (msg ? ': ' + msg : ''));
      }
    });

    stateAction = room.makeAction('state');
    chatAction = room.makeAction('chat');
    ctrlAction = room.makeAction('ctrl');
    stateAction.onMessage = (data, ctx) => onPeerState(ctx.peerId, data);
    chatAction.onMessage = data => ingestMessages(data);
    ctrlAction.onMessage = (data, ctx) => onCtrl(ctx.peerId, data);

    addSelfTile();
    room.onPeerJoin = id => onPeerJoin(id);
    room.onPeerLeave = id => onPeerLeave(id);
    room.onPeerStream = (stream, peerId, meta) => onPeerStream(stream, peerId, meta);

    lobby.hidden = true;
    call.hidden = false;
    layout();
    updateControls();
    toast('Вы в комнате');
  } catch (e) {
    console.error(e);
    toast('Не удалось загрузить P2P-библиотеку. Проверьте подключение к интернету', 3500);
    lobbyError.textContent = 'Ошибка загрузки P2P-библиотеки — проверьте интернет и обновите страницу';
    lobbyError.hidden = false;
    joinCallBtn.disabled = false;
    joinCallBtn.textContent = 'Войти в комнату';
  }
}

function leaveRoom() {
  stopScreen();
  if (room) { try { room.leave(); } catch {} }
  if (localStream) localStream.getTracks().forEach(t => { try { t.stop(); } catch {} });
  location.href = 'index.html';
}

window.addEventListener('beforeunload', () => {
  if (room) { try { room.leave(); } catch {} }
});

// ---------- wiring ----------
joinCallBtn.addEventListener('click', joinCall);
nameInput.addEventListener('input', updateControls);
lobbyMicBtn.addEventListener('click', () => setMic(!myState.micOn));
lobbyCamBtn.addEventListener('click', () => setCam(!myState.camOn));

micBtn.addEventListener('click', () => setMic(!myState.micOn));
camBtn.addEventListener('click', () => setCam(!myState.camOn));
screenBtn.addEventListener('click', toggleScreen);
handBtn.addEventListener('click', () => {
  myState.hand = !myState.hand;
  updateControls();
  broadcast();
});
chatBtn.addEventListener('click', () => toggleChat());
chatCloseBtn.addEventListener('click', () => toggleChat(false));
leaveBtn.addEventListener('click', leaveRoom);
copyLinkBtn.addEventListener('click', async () => {
  toast((await copyText(roomLink(roomId, roomName))) ? 'Ссылка скопирована' : 'Не удалось скопировать');
});

focusCloseBtn.addEventListener('click', e => {
  e.stopPropagation();
  focusedScreenId = null;
  renderPresentation();
});
focusMain.addEventListener('click', () => {
  focusedScreenId = null;
  renderPresentation();
});

// ---------- init ----------
nameInput.value = (() => {
  try { return localStorage.getItem(LS_NAME) || ''; } catch { return ''; }
})();
const previewPromise = initPreview();
updateControls();
layout();
requestAnimationFrame(tick);

function msgTime(ts) {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function linkify(text) {
  const re = /\b(https?:\/\/[^\s<]+|www\.[^\s<]+)\b/gi;
  return text.replace(re, m => {
    const href = m.startsWith('http') ? m : 'https://' + m;
    return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + m + '</a>';
  });
}

function makeMsgId() {
  return selfId + '-' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
}

function renderMsg(m) {
  const el = document.createElement('div');
  el.className = 'msg' + (m.from === selfId ? ' own' : '');
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.textContent = (m.from === selfId ? 'Вы' : (m.name || 'Участник')) +
    ' · ' + msgTime(m.ts || Date.now());
  const body = document.createElement('div');
  body.className = 'msg-body';
  if (m.type === 'image') {
    const img = document.createElement('img');
    img.className = 'msg-img';
    img.src = m.dataUrl;
    img.loading = 'lazy';
    img.addEventListener('click', () => window.open(m.dataUrl, '_blank', 'noopener'));
    body.appendChild(img);
    if (m.text && m.text.trim()) {
      const span = document.createElement('div');
      span.style.marginTop = '6px';
      span.innerHTML = linkify(String(m.text).slice(0, 2000));
      body.appendChild(span);
    }
  } else {
    body.innerHTML = linkify(String(m.text || '').slice(0, 2000));
  }
  el.append(meta, body);
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendTextMsg(text) {
  const msg = {
    id: makeMsgId(),
    from: selfId,
    name: myState.name,
    type: 'text',
    text,
    ts: Date.now()
  };
  chatHistory.push(msg);
  renderMsg(msg);
  Promise.resolve(chatAction.send(msg)).catch(() => {});
}

function sendImageMsg(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;
    const msg = {
      id: makeMsgId(),
      from: selfId,
      name: myState.name,
      type: 'image',
      dataUrl,
      text: '',
      ts: Date.now()
    };
    chatHistory.push(msg);
    renderMsg(msg);
    Promise.resolve(chatAction.send(msg)).catch(() => {});
  };
  reader.readAsDataURL(file);
}

