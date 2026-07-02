'use strict';

const $ = (id) => document.getElementById(id);

const secConnected = $('sec-connected');
const secSetup     = $('sec-setup');
const secLastSync  = $('sec-last-sync');
const secSettings  = $('sec-settings');

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  const [status, cfg] = await Promise.all([api.getStatus(), api.getConfig()]);

  $('input-watchdir').value        = cfg.watchDir;
  $('chk-autostart').checked       = cfg.autostart;
  $('sel-notifications').value     = cfg.notifications || 'all';

  renderSavedProfiles(cfg);

  // Mostra versão no header
  try {
    const ver = await api.getAppVersion?.();
    if (ver) $('app-version').textContent = `v${ver}`;
  } catch {}

  render(status);
  initUpdateBanner();

  // Recupera estado do update caso a janela tenha aberto após o check já ter rodado
  try {
    const us = await api.getUpdateStatus?.();
    if (us) renderUpdateStatus(us);
  } catch {}
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
    renderQueueBadge(status);
    const profileBtn = $('btn-view-profile');
    if (profileBtn) profileBtn.hidden = !status.hasProfile;
  }

  if (status.watchDir) $('input-watchdir').value = status.watchDir;

  const warnEl = $('watchdir-warn');
  warnEl.hidden = !(status.watcherError || status.watchDirExists === false);
  if (status.watcherError) warnEl.textContent = `⚠ ${status.watcherError}`;

  const history = status.syncHistory || (status.lastSync ? [status.lastSync] : []);
  if (history.length > 0) {
    secLastSync.hidden = false;
    renderSyncHistory(history);
  } else {
    secLastSync.hidden = true;
  }
}

function renderQueueBadge(status) {
  const el = $('badge-queue');
  if (!el) return;
  const n = status.pendingQueue || 0;
  if (n > 0) {
    el.textContent = `↺ ${n} na fila`;
    el.className   = 'badge badge-warn';
    el.hidden      = false;
  } else {
    el.hidden = true;
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

  $('btn-dismiss-update').addEventListener('click', () => {
    $('update-banner').hidden = true;
  });
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
      banner.hidden     = false;
      banner.className  = 'update-banner update-ok';
      icon.textContent  = '✓';
      title.textContent = 'Aplicativo atualizado';
      sub.textContent   = 'Você está usando a versão mais recente.';
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
      banner.hidden     = false;
      banner.className  = 'update-banner update-error';
      icon.textContent  = '✕';
      title.textContent = 'Erro ao verificar atualizações';
      sub.textContent   = data.message || '';
      break;

    case 'dev':
      banner.hidden     = false;
      banner.className  = 'update-banner update-checking update-dev';
      icon.textContent  = '⚙';
      title.textContent = 'Modo desenvolvimento';
      sub.textContent   = 'Atualizações automáticas desativadas.';
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
    renderSavedProfiles(cfg);
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
  const [status, cfg] = await Promise.all([api.getStatus(), api.getConfig()]);
  render(status);
  renderSavedProfiles(cfg);
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

$('sel-notifications').addEventListener('change', async (e) => {
  await api.saveSettings({ notifications: e.target.value });
});

// ── Limpar histórico ──────────────────────────────────────────────────────

$('btn-clear-history').addEventListener('click', async () => {
  await api.clearHistory();
  render(await api.getStatus());
});

// ── Perfis salvos ─────────────────────────────────────────────────────────

function renderSavedProfiles(cfg) {
  const profiles = (cfg.savedProfiles || []).filter(p => p.nick !== cfg.nick);
  const section  = $('saved-profiles-setup');
  const list     = $('profiles-list-setup');
  section.hidden = profiles.length === 0;
  list.innerHTML = '';
  profiles.forEach(p => {
    const wrap = document.createElement('div');
    wrap.className = 'profile-chip-wrap';

    const btn = document.createElement('button');
    btn.className   = 'profile-chip';
    btn.textContent = p.nick;
    btn.addEventListener('click', async () => {
      setConnecting(true);
      $('connect-error').hidden = true;
      const result = await api.switchProfile(p.nick);
      if (result.success) {
        const [status, cfg2] = await Promise.all([api.getStatus(), api.getConfig()]);
        $('input-watchdir').value = cfg2.watchDir;
        render(status);
        renderSavedProfiles(cfg2);
      } else {
        showError(result.error || 'Erro ao trocar de perfil.');
      }
      setConnecting(false);
    });

    const rm = document.createElement('button');
    rm.className   = 'profile-chip-remove';
    rm.textContent = '×';
    rm.title       = 'Remover perfil salvo';
    rm.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.removeProfile(p.nick);
      const cfg2 = await api.getConfig();
      renderSavedProfiles(cfg2);
    });

    wrap.appendChild(btn);
    wrap.appendChild(rm);
    list.appendChild(wrap);
  });
}

// ── Sync manual ───────────────────────────────────────────────────────────

$('btn-manual-sync').addEventListener('click', async () => {
  const btn = $('btn-manual-sync');
  const msg = $('manual-sync-msg');
  btn.disabled    = true;
  btn.textContent = '↺ Sincronizando...';
  msg.hidden      = true;
  try {
    const result = await api.manualSync();
    if (!result.success) {
      msg.textContent = result.error || 'Nenhum arquivo encontrado.';
      msg.hidden      = false;
      setTimeout(() => { msg.hidden = true; }, 4000);
    }
  } finally {
    setTimeout(() => { btn.disabled = false; btn.textContent = '↺ Sync agora'; }, 1500);
  }
});

$('btn-view-profile').addEventListener('click', () => api.openProfile());

// ── Footer ────────────────────────────────────────────────────────────────

$('btn-open-site').addEventListener('click', () => api.openSite());

// ── Real-time updates ─────────────────────────────────────────────────────

api.onStatusUpdate((status) => render(status));

function renderSyncHistory(history) {
  const ul = $('sync-history');
  ul.innerHTML = '';
  history.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'sync-item' + (item.ok === false ? ' sync-item-err' : '');
    if (item.ok === false && item.error) li.title = item.error;

    const icon = item.ok === false ? '✗' : '✓';
    const name = item.characterName || (item.ok === false ? (item.error || 'Erro') : '—');
    const when = timeAgo(item.ts);

    // Delta de score em relação ao sync anterior bem-sucedido
    let delta = null;
    if (item.ok && item.score != null) {
      for (let j = i + 1; j < history.length; j++) {
        if (history[j].ok && history[j].score != null) {
          delta = item.score - history[j].score;
          break;
        }
      }
    }

    const iconEl = document.createElement('span');
    iconEl.className   = 'sync-icon';
    iconEl.textContent = icon;

    const nameEl = document.createElement('span');
    nameEl.className   = 'sync-name';
    nameEl.textContent = name;

    const timeEl = document.createElement('span');
    timeEl.className   = 'sync-time';
    timeEl.textContent = when;

    li.appendChild(iconEl);
    li.appendChild(nameEl);

    if (item.score != null) {
      const scoreEl = document.createElement('span');
      scoreEl.className   = 'sync-score';
      scoreEl.textContent = `${item.score} pts`;
      li.appendChild(scoreEl);
    }

    if (delta !== null && delta > 0) {
      const deltaEl = document.createElement('span');
      deltaEl.className   = 'sync-delta';
      deltaEl.textContent = `+${delta}`;
      li.appendChild(deltaEl);
    }

    if (item.rankPosition) {
      const rankEl = document.createElement('span');
      rankEl.className   = 'sync-rank';
      rankEl.textContent = `#${item.rankPosition}`;
      li.appendChild(rankEl);
    }

    li.appendChild(timeEl);
    ul.appendChild(li);
  });
}

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
