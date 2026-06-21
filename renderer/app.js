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

  // Mostra versão no header
  try {
    const ver = await api.getAppVersion?.();
    if (ver) $('app-version').textContent = `v${ver}`;
  } catch {}

  render(status);
  initUpdateBanner();
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

// ── Update banner ─────────────────────────────────────────────────────────

function initUpdateBanner() {
  api.onUpdateStatus(renderUpdateStatus);
  $('btn-check-update').addEventListener('click', () => {
    $('btn-check-update').disabled = true;
    renderUpdateStatus({ phase: 'checking' });
    api.checkForUpdates().finally(() => {
      setTimeout(() => { $('btn-check-update').disabled = false; }, 5000);
    });
  });
  $('btn-install-update').addEventListener('click', () => api.installUpdate());
}

function renderUpdateStatus(data) {
  const banner      = $('update-banner');
  const icon        = $('update-icon');
  const title       = $('update-title');
  const sub         = $('update-sub');
  const progressWrap = $('update-progress-wrap');
  const progressBar  = $('update-progress-bar');
  const progressLabel = $('update-progress-label');
  const btnInstall  = $('btn-install-update');

  progressWrap.hidden = true;
  btnInstall.hidden   = true;

  switch (data.phase) {
    case 'checking':
      banner.hidden      = false;
      banner.className   = 'update-banner update-checking';
      icon.textContent   = '↻';
      title.textContent  = 'Verificando atualizações...';
      sub.textContent    = '';
      break;

    case 'up-to-date':
      banner.hidden      = false;
      banner.className   = 'update-banner update-ok';
      icon.textContent   = '✓';
      title.textContent  = 'Aplicativo atualizado';
      sub.textContent    = 'Você está usando a versão mais recente.';
      // Esconde após 4s
      setTimeout(() => { banner.hidden = true; }, 4000);
      break;

    case 'available':
      banner.hidden      = false;
      banner.className   = 'update-banner update-available';
      icon.textContent   = '↑';
      title.textContent  = `Nova versão disponível: ${data.version}`;
      sub.textContent    = 'Baixando atualização...';
      break;

    case 'downloading':
      banner.hidden       = false;
      banner.className    = 'update-banner update-downloading';
      icon.textContent    = '↓';
      title.textContent   = 'Baixando atualização...';
      sub.textContent     = '';
      progressWrap.hidden = false;
      progressBar.style.width = `${data.percent}%`;
      progressLabel.textContent = `${data.percent}%`;
      break;

    case 'downloaded':
      banner.hidden      = false;
      banner.className   = 'update-banner update-ready';
      icon.textContent   = '★';
      title.textContent  = `Versão ${data.version} pronta para instalar`;
      sub.textContent    = 'O app será reiniciado após a instalação.';
      btnInstall.hidden  = false;
      break;

    case 'error':
      banner.hidden      = false;
      banner.className   = 'update-banner update-error';
      icon.textContent   = '✕';
      title.textContent  = 'Erro ao verificar atualizações';
      sub.textContent    = data.message || '';
      setTimeout(() => { banner.hidden = true; }, 6000);
      break;

    default:
      banner.hidden = true;
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
