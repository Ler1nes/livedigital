import { toast, copyText, roomLink } from './ui.js';

const LS_KEY = 'lr_rooms';
const $ = s => document.querySelector(s);

const nameInput = $('#roomNameInput');
const createBtn = $('#createBtn');
const joinInput = $('#joinInput');
const joinBtn = $('#joinBtn');
const grid = $('#roomsGrid');
const empty = $('#emptyState');
const countEl = $('#roomsCount');

function loadRooms() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
  catch { return []; }
}

function saveRooms(rooms) {
  localStorage.setItem(LS_KEY, JSON.stringify(rooms));
}

function genId() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString('ru-RU', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function render() {
  const rooms = loadRooms();
  grid.innerHTML = '';
  countEl.textContent = rooms.length ? `· ${rooms.length}` : '';
  empty.hidden = rooms.length > 0;

  for (const r of rooms) {
    const link = roomLink(r.id, r.name);
    const card = document.createElement('div');
    card.className = 'room-card';
    card.innerHTML = `
      <div class="rc-name"></div>
      <div class="rc-date">создана ${fmtDate(r.created)}</div>
      <div class="rc-link"></div>
      <div class="rc-actions">
        <button class="btn btn-primary rc-open">Открыть</button>
        <button class="btn btn-ghost rc-copy">Копировать ссылку</button>
        <button class="btn rc-del" title="Удалить комнату">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>`;
    card.querySelector('.rc-name').textContent = r.name;
    card.querySelector('.rc-link').textContent = link;
    card.querySelector('.rc-open').onclick = () => { location.href = link; };
    card.querySelector('.rc-copy').onclick = async () => {
      toast((await copyText(link)) ? 'Ссылка скопирована' : 'Не удалось скопировать');
    };
    card.querySelector('.rc-del').onclick = () => {
      if (!confirm(`Удалить комнату «${r.name}» из списка? Ссылка перестанет открываться.`)) return;
      saveRooms(loadRooms().filter(x => x.id !== r.id));
      render();
    };
    grid.appendChild(card);
  }
}

function createRoom() {
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    toast('Введите название комнаты');
    return;
  }
  const room = { id: genId(), name, created: Date.now() };
  const rooms = loadRooms();
  rooms.unshift(room);
  saveRooms(rooms);
  nameInput.value = '';
  render();
  copyText(roomLink(room.id, room.name)).then(ok =>
    toast(ok ? 'Комната создана — ссылка скопирована' : 'Комната создана')
  );
}

function joinByInput() {
  const raw = joinInput.value.trim();
  if (!raw) return;
  let url = null;
  try {
    if (/^https?:\/\//i.test(raw)) url = new URL(raw);
  } catch {}
  if (url) {
    location.href = url.toString();
    return;
  }
  location.href = 'room.html?room=' + encodeURIComponent(raw.split(/[\s/]+/).pop());
}

createBtn.addEventListener('click', createRoom);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });
joinBtn.addEventListener('click', joinByInput);
joinInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinByInput(); });

render();
