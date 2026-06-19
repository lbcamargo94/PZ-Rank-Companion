'use strict';

const $ = (id) => document.getElementById(id);

const secConnected = $('sec-connected');
const secSetup     = $('sec-setup');
const secLastSync  = $('sec-last-sync');
const secSettings  = $('sec-settings');

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  const [status, cfg] = await Promise.all([api.getStatus(), api.getConfig()]);

  $('input-watchdir').value  = cfg.watchDir;
  $('chk-autostart').checked = cfg.autostart;

  render(status);
}

function render(status) {
  const connected = status.connected;

  secConnected.hidden = !connected;
  secSetup.hidden     = connected;
  secSettings.hidden  = !connected;

  if (connected) {
    $('nick-label').textContent = status.nick;
    renderGameBadge(status);
    renderSyncBadge(status);
  }

  if (status.watchDir) $('input-watchdir').value = status.watchDir;

  const warnEl = $('watchdir-warn');
  warnEl.hidden = !(status.watcherError || status.watchDirExists === false);
  if (status.watcherError) warnEl.textContent = `⚠ ${status.watcherError}`;

  if (status.lastSync) {
    secLastSync.hidden = false;
    $('last-char').textContent  = status.lastSync.characterName || '—';
    $('last-score').textContent = status.lastSync.score != null ? `${status.lastSync.score} pts` : '—';
    $('last-time').textContent  = timeAgo(status.lastSync.ts);
  } else {
    secLastSync.hidden = true;
  }
}

function renderGameBadge(status) {
  const el = $('badge-game');
  if (status.gameRunning) {
    el.textContent = '▶ Jogo ativo';
    el.className   = 'badge badge-green';
  } else {
    el.textContent = '◻ Jogo não detectado';
    el.className   = 'badge badge-muted';
  }
}

function renderSyncBadge(status) {
  const el = $('badge-sync');
  if (status.watcherError) {
    el.textContent = '⚠ Erro na pasta';
    el.className   = 'badge badge-warn';
  } else {
    const map = { idle: 'Monitorando...', syncing: 'Sincronizando...', ok: 'Sync OK ✓', error: 'Erro no sync' };
    el.textContent = map[status.syncStatus] ?? 'Monitorando...';
    el.className   = status.syncStatus === 'ok' ? 'badge badge-green' : 'badge badge-muted';
  }
}

// ── Conectar ──────────────────────────────────────────────────────────────

$('btn-connect').addEventListener('click', async () => {
  const nick = $('input-nick').value.trim();

  $('connect-error').hidden = true;
  if (!nick) { showError('Digite seu nick do ranking.'); return; }

  setConnecting(true);

  const result = await api.lookupPlayer(nick);

  if (result.success) {
    const [status, cfg] = await Promise.all([api.getStatus(), api.getConfig()]);
    $('input-watchdir').value = cfg.watchDir;
    render(status);
  } else {
    showError(result.error || 'Jogador não encontrado ou não aprovado.');
  }

  setConnecting(false);
});

$('input-nick').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-connect').click(); });

function setConnecting(loading) {
  const btn = $('btn-connect');
  btn.disabled    = loading;
  btn.textContent = loading ? 'Conectando...' : 'Conectar';
}

function showError(msg) {
  const el = $('connect-error');
  el.textContent = msg;
  el.hidden = false;
}

// ── Desconectar ───────────────────────────────────────────────────────────

$('btn-disconnect').addEventListener('click', async () => {
  await api.disconnect();
  render(await api.getStatus());
});

// ── Folder picker ─────────────────────────────────────────────────────────

$('btn-pick-folder').addEventListener('click', async () => {
  const result = await api.pickFolder();
  if (result.success) {
    $('input-watchdir').value = result.path;
    const status = await api.getStatus();
    render(status);
  }
});

// ── Autostart ─────────────────────────────────────────────────────────────

$('chk-autostart').addEventListener('change', async (e) => {
  await api.toggleAutostart(e.target.checked);
});

// ── Footer ────────────────────────────────────────────────────────────────

$('btn-open-site').addEventListener('click', () => api.openSite());

// ── Real-time updates ─────────────────────────────────────────────────────

api.onStatusUpdate((status) => render(status));

// ── Helpers ───────────────────────────────────────────────────────────────

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'agora mesmo';
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  return `há ${Math.floor(m / 60)}h`;
}

// ── Start ─────────────────────────────────────────────────────────────────

init();
