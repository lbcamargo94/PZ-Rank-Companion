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

  renderModOutdatedBanner(status);

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
  const group = $('queue-group');
  const badge = $('badge-queue');
  if (!group || !badge) return;
  const n = status.pendingQueue || 0;
  if (n > 0) {
    badge.textContent = `↺ ${n} na fila`;
    group.hidden      = false;
  } else {
    group.hidden = true;
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

// ── Mod outdated banner ───────────────────────────────────────────────────

let modOutdatedDismissed = false;

function renderModOutdatedBanner(status) {
  const banner = $('mod-outdated-banner');
  if (!banner) return;
  if (!status.modOutdated) {
    modOutdatedDismissed = false; // mod atualizado — permite mostrar de novo futuramente
    banner.hidden = true;
  } else if (!modOutdatedDismissed) {
    banner.hidden = false;
  }
}

$('btn-open-workshop').addEventListener('click', () => {
  api.openExternal?.('https://steamcommunity.com/sharedfiles/filedetails/?id=3746228308');
});

$('btn-dismiss-mod-outdated').addEventListener('click', () => {
  modOutdatedDismissed = true;
  $('mod-outdated-banner').hidden = true;
});

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

// Toggle mostrar/ocultar senha
$('btn-toggle-pass').addEventListener('click', () => {
  const inp = $('input-password');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

$('btn-connect').addEventListener('click', async () => {
  const email    = $('input-email').value.trim();
  const password = $('input-password').value;

  $('connect-error').hidden = true;
  if (!email)    { showError('Digite seu email.'); return; }
  if (!password) { showError('Digite sua senha.'); return; }

  setConnecting(true);

  const result = await api.loginPlayer(email, password);

  if (result.success) {
    const [status, cfg] = await Promise.all([api.getStatus(), api.getConfig()]);
    $('input-watchdir').value = cfg.watchDir;
    $('input-password').value = '';
    render(status);
    renderSavedProfiles(cfg);
  } else {
    showError(result.error || 'Email ou senha incorretos.');
  }

  setConnecting(false);
});

$('input-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-connect').click(); });
$('input-email').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('input-password').focus(); });

// Links de esqueci senha e cadastro — abre o site
$('link-forgot-password').addEventListener('click', (e) => {
  e.preventDefault();
  api.openExternal?.(`${window._siteUrl ?? 'https://pzrank.com.br'}/redefinir-senha`);
});
$('link-register').addEventListener('click', (e) => {
  e.preventDefault();
  api.openExternal?.(`${window._siteUrl ?? 'https://pzrank.com.br'}`);
});

function setConnecting(loading) {
  const btn = $('btn-connect');
  btn.disabled    = loading;
  btn.textContent = loading ? 'Entrando...' : 'Entrar';
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

// ── Limpar fila de sync pendente ──────────────────────────────────────────

$('btn-clear-queue').addEventListener('click', async () => {
  await api.clearQueue();
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

    if (item.ok && item.disqualificationReason) {
      const clearBtn = document.createElement('button');
      clearBtn.className   = 'btn-clear-violation';
      clearBtn.title       = 'Escreve sinal para o mod limpar as flags de violação no próximo carregamento do save';
      clearBtn.textContent = 'Limpar violação';
      clearBtn.addEventListener('click', async () => {
        clearBtn.disabled = true;
        const result = await api.clearViolation();
        clearBtn.textContent = result.success ? 'Sinal enviado ✓' : 'Erro';
        if (!result.success) clearBtn.disabled = false;
      });
      li.appendChild(clearBtn);
    }

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

// ── Meus Saves ───────────────────────────────────────────────────────────

let selectedCharName = null;
let compareChars     = new Set();  // slugs of up to 2 chars selected for comparison
let charLiMap        = new Map();  // charName → { li, cmpBtn }

// Achievement filter state — persists within the session
let achSearch       = '';
let achTierFilter   = '';     // '' = all
let achStatusFilter = 'all';  // 'all' | 'unlocked' | 'locked'

async function initSaves() {
  const characters = await api.getCharacters?.();
  renderSaves(characters || []);
  api.onCharactersUpdate?.((chars) => renderSaves(chars || []));
  $('btn-refresh-saves').addEventListener('click', async () => {
    renderSaves((await api.getCharacters?.()) || []);
  });
}

function renderSaves(characters) {
  const section = $('sec-saves');
  const ul      = $('saves-list');
  ul.innerHTML  = '';
  $('save-detail-panel').innerHTML = '';
  selectedCharName = null;
  compareChars.clear();
  charLiMap.clear();

  if (!characters || characters.length === 0) {
    section.hidden = true;
    return;
  }

  section.hidden = false;

  characters.forEach(c => {
    const li = document.createElement('li');
    li.className = 'save-item';
    li.title = `Última vez visto: ${new Date(c.last_seen).toLocaleDateString('pt-BR')}`;

    const dot = document.createElement('span');
    dot.className = 'save-status ' + (c.status === 'alive' ? 'alive' : c.status === 'dead' ? 'dead' : '');

    const name = document.createElement('span');
    name.className   = 'save-name';
    name.textContent = c.char_name;

    const score = document.createElement('span');
    score.className   = 'save-score';
    score.textContent = c.score > 0 ? `${c.score} pts` : '';

    const pos = document.createElement('span');
    pos.className   = 'save-time';
    pos.textContent = c.rank_position ? `#${c.rank_position}` : '';

    const cmpBtn = document.createElement('button');
    cmpBtn.className   = 'btn-cmp';
    cmpBtn.textContent = '⇔';
    cmpBtn.title       = 'Selecionar para comparar';
    cmpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCompare(c.char_name);
    });

    charLiMap.set(c.char_name, { li, cmpBtn });

    li.append(dot, name, score, pos, cmpBtn);
    li.addEventListener('click', () => {
      if (compareChars.size > 0) return; // em modo comparação, clique abre detalhe apenas se não há seleção ativa
      openSaveDetail(c.char_name);
    });
    ul.appendChild(li);
  });
}

function toggleCompare(charName) {
  const refs = charLiMap.get(charName);
  if (!refs) return;

  if (compareChars.has(charName)) {
    compareChars.delete(charName);
    refs.li.classList.remove('save-item-cmp');
    refs.cmpBtn.classList.remove('btn-cmp-active');
  } else {
    if (compareChars.size >= 2) {
      const evict = [...compareChars][0];
      compareChars.delete(evict);
      const evictRefs = charLiMap.get(evict);
      if (evictRefs) {
        evictRefs.li.classList.remove('save-item-cmp');
        evictRefs.cmpBtn.classList.remove('btn-cmp-active');
      }
    }
    compareChars.add(charName);
    refs.li.classList.add('save-item-cmp');
    refs.cmpBtn.classList.add('btn-cmp-active');
  }

  if (compareChars.size === 2) {
    selectedCharName = null;
    const [a, b] = [...compareChars];
    openCompare(a, b);
  } else if (compareChars.size === 0) {
    $('save-detail-panel').innerHTML = '';
    selectedCharName = null;
  } else {
    // 1 selecionado — aguarda o segundo
    $('save-detail-panel').innerHTML = '';
    const hint = document.createElement('p');
    hint.style.cssText = 'font-size:11px;color:var(--muted);padding:8px 0;text-align:center;';
    hint.textContent   = 'Selecione outro personagem para comparar…';
    $('save-detail-panel').appendChild(hint);
    selectedCharName = null;
  }
}

async function openCompare(charNameA, charNameB) {
  const panel = $('save-detail-panel');
  panel.innerHTML = '';

  const [detailA, detailB] = await Promise.all([
    api.getCharacterDetail?.(charNameA),
    api.getCharacterDetail?.(charNameB),
  ]);
  if (!detailA || !detailB) return;

  const div = document.createElement('div');
  div.className = 'compare-panel';

  const TIER_ORD = { legendary: 0, platinum: 1, gold: 2, silver: 3, bronze: 4 };
  const topTierA = detailA.achievements?.reduce((best, a) => {
    const o = TIER_ORD[a.achievement_tier] ?? 9;
    return o < best ? o : best;
  }, 9);
  const topTierB = detailB.achievements?.reduce((best, a) => {
    const o = TIER_ORD[a.achievement_tier] ?? 9;
    return o < best ? o : best;
  }, 9);
  const tierName = ['Lendária','Platina','Ouro','Prata','Bronze'];

  const rows = [
    { label: '',            a: charNameA,                                          b: charNameB,                                          isHeader: true },
    { label: 'Score',       a: fmtNum(detailA.character?.score),                   b: fmtNum(detailB.character?.score),                   numA: detailA.character?.score ?? 0,       numB: detailB.character?.score ?? 0,       higherBetter: true  },
    { label: 'Posição',     a: detailA.character?.rank_position ? '#'+detailA.character.rank_position : '—', b: detailB.character?.rank_position ? '#'+detailB.character.rank_position : '—', numA: detailA.character?.rank_position ?? 999, numB: detailB.character?.rank_position ?? 999, higherBetter: false },
    { label: 'Status',      a: statusLabel(detailA.character?.status),              b: statusLabel(detailB.character?.status),              numA: null, numB: null },
    { label: 'Syncs',       a: detailA.history?.length ?? 0,                       b: detailB.history?.length ?? 0,                       numA: null, numB: null },
    { label: 'Conquistas',  a: detailA.achievements?.length ?? 0,                  b: detailB.achievements?.length ?? 0,                  numA: detailA.achievements?.length ?? 0,   numB: detailB.achievements?.length ?? 0,   higherBetter: true  },
    { label: 'Melhor tier', a: topTierA < 9 ? tierName[topTierA] : '—',           b: topTierB < 9 ? tierName[topTierB] : '—',           numA: topTierA < 9 ? (4 - topTierA) : 0,  numB: topTierB < 9 ? (4 - topTierB) : 0,  higherBetter: true  },
    { label: 'Primeiro sync', a: fmtDate(detailA.character?.first_seen),           b: fmtDate(detailB.character?.first_seen),             numA: null, numB: null },
  ];

  const table = document.createElement('table');
  table.className = 'compare-table';

  rows.forEach(row => {
    const tr = document.createElement('tr');
    if (row.isHeader) tr.className = 'compare-header';

    const tdLabel = document.createElement(row.isHeader ? 'th' : 'td');
    tdLabel.className   = 'compare-label';
    tdLabel.textContent = row.label;
    tr.appendChild(tdLabel);

    ['a', 'b'].forEach((side, idx) => {
      const td = document.createElement(row.isHeader ? 'th' : 'td');
      td.className   = 'compare-' + side;
      td.textContent = row[side];

      if (!row.isHeader && row.numA !== null && row.numB !== null && row.numA !== row.numB) {
        const better = row.higherBetter
          ? (side === 'a' ? row.numA > row.numB : row.numB > row.numA)
          : (side === 'a' ? row.numA < row.numB : row.numB < row.numA);
        if (better) td.classList.add('compare-winner');
      }

      tr.appendChild(td);
    });

    table.appendChild(tr);
  });

  div.appendChild(table);
  panel.appendChild(div);
}

function statusLabel(s) {
  if (s === 'alive') return '● Vivo';
  if (s === 'dead')  return '✕ Morto';
  return '— Desconhecido';
}

function fmtNum(v) {
  if (v == null || v === 0) return '—';
  return Number(v).toLocaleString('pt-BR');
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('pt-BR');
}

async function openSaveDetail(charName) {
  const panel = $('save-detail-panel');

  if (selectedCharName === charName) {
    selectedCharName = null;
    panel.innerHTML  = '';
    return;
  }
  selectedCharName = charName;

  // Reset filters when opening a new character
  achSearch       = '';
  achTierFilter   = '';
  achStatusFilter = 'all';

  const [detail, catalog] = await Promise.all([
    api.getCharacterDetail?.(charName),
    api.getCatalog?.(),
  ]);
  if (!detail) { panel.innerHTML = ''; return; }

  panel.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'save-detail';

  // ── Export row ────────────────────────────────────────────────────────
  const exportRow = document.createElement('div');
  exportRow.className = 'save-detail-export-row';

  const expLabel = document.createElement('span');
  expLabel.className   = 'save-detail-title';
  expLabel.textContent = charName;

  const expJson = document.createElement('button');
  expJson.className   = 'btn btn-ghost btn-sm';
  expJson.textContent = '↓ JSON';
  expJson.title       = 'Exportar histórico e conquistas como JSON';
  expJson.addEventListener('click', async () => {
    expJson.disabled = true;
    await api.exportCharacterData?.(charName, 'json');
    expJson.disabled = false;
  });

  const expCsv = document.createElement('button');
  expCsv.className   = 'btn btn-ghost btn-sm';
  expCsv.textContent = '↓ CSV';
  expCsv.title       = 'Exportar histórico de sync como CSV';
  expCsv.addEventListener('click', async () => {
    expCsv.disabled = true;
    await api.exportCharacterData?.(charName, 'csv');
    expCsv.disabled = false;
  });

  exportRow.append(expLabel, expJson, expCsv);
  div.appendChild(exportRow);

  // ── Rank history chart ────────────────────────────────────────────────
  const rankPoints = (detail.history || []).filter(h => h.rank_position != null);
  if (rankPoints.length >= 2) {
    const chartSection = document.createElement('div');
    chartSection.className = 'save-chart-section';

    const chartTitle = document.createElement('p');
    chartTitle.className   = 'save-detail-title';
    chartTitle.textContent = 'Histórico de posição no ranking';
    chartSection.appendChild(chartTitle);
    chartSection.appendChild(buildRankChart(rankPoints));
    div.appendChild(chartSection);
  }

  // ── Achievements ──────────────────────────────────────────────────────
  const allCatalog    = Array.isArray(catalog) && catalog.length > 0 ? catalog : [];
  const unlockedSlugs = new Set((detail.achievements || []).map(a => a.achievement_slug));
  const unlockedMap   = new Map((detail.achievements || []).map(a => [a.achievement_slug, a]));

  const achSection = document.createElement('div');
  achSection.className = 'ach-section';

  const achCountLabel = allCatalog.length > 0
    ? `Conquistas (${unlockedSlugs.size}/${allCatalog.length})`
    : `Conquistas (${unlockedSlugs.size})`;

  const achTitleEl = document.createElement('p');
  achTitleEl.className   = 'save-detail-title';
  achTitleEl.textContent = achCountLabel;
  achSection.appendChild(achTitleEl);

  if (allCatalog.length > 0) {
    // Progress bar
    const progressWrap = document.createElement('div');
    progressWrap.className = 'ach-progress-wrap';
    const progressFill = document.createElement('div');
    progressFill.className   = 'ach-progress-fill';
    const pct = Math.round((unlockedSlugs.size / allCatalog.length) * 100);
    progressFill.style.width = pct + '%';
    progressWrap.appendChild(progressFill);
    achSection.appendChild(progressWrap);

    // Filters
    const filterRow = document.createElement('div');
    filterRow.className = 'ach-filter-row';

    const searchInput = document.createElement('input');
    searchInput.className   = 'ach-search';
    searchInput.placeholder = 'Buscar…';
    searchInput.type        = 'text';
    searchInput.value       = achSearch;

    const tierSel = document.createElement('select');
    tierSel.className = 'sel-settings ach-sel';
    [['', 'Nível'], ['legendary', '🔴 Lendária'], ['platinum', '🟣 Platina'], ['gold', '🟡 Ouro'], ['silver', '⚪ Prata'], ['bronze', '🟤 Bronze']].forEach(([val, lbl]) => {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = lbl;
      if (achTierFilter === val) opt.selected = true;
      tierSel.appendChild(opt);
    });

    const statusSel = document.createElement('select');
    statusSel.className = 'sel-settings ach-sel';
    [['all', 'Todas'], ['unlocked', '✓ Desbloqueadas'], ['locked', '🔒 Bloqueadas']].forEach(([val, lbl]) => {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = lbl;
      if (achStatusFilter === val) opt.selected = true;
      statusSel.appendChild(opt);
    });

    filterRow.append(searchInput, tierSel, statusSel);
    achSection.appendChild(filterRow);

    const achList = document.createElement('ul');
    achList.className = 'achievement-list-full';

    function renderAchList() {
      achList.innerHTML = '';
      const q      = achSearch.toLowerCase().trim();
      const tier   = achTierFilter;
      const status = achStatusFilter;

      const TIER_ORD = { legendary: 0, platinum: 1, gold: 2, silver: 3, bronze: 4 };

      const visible = allCatalog.filter(a => {
        if (tier   && a.tier !== tier) return false;
        if (status === 'unlocked' && !unlockedSlugs.has(a.slug)) return false;
        if (status === 'locked'   &&  unlockedSlugs.has(a.slug)) return false;
        if (q && !a.name?.toLowerCase().includes(q) && !a.description?.toLowerCase().includes(q)) return false;
        return true;
      }).sort((a, b) => {
        const aU = unlockedSlugs.has(a.slug) ? 0 : 1;
        const bU = unlockedSlugs.has(b.slug) ? 0 : 1;
        if (aU !== bU) return aU - bU;
        return (TIER_ORD[a.tier] ?? 9) - (TIER_ORD[b.tier] ?? 9);
      });

      if (visible.length === 0) {
        const li = document.createElement('li');
        li.className   = 'ach-item-empty';
        li.textContent = 'Nenhuma conquista encontrada.';
        achList.appendChild(li);
        return;
      }

      const TIER_CLR = { legendary: '#c0392b', platinum: '#9b59b6', gold: '#d4ac0d', silver: '#95a5a6', bronze: '#e67e22' };

      visible.forEach(a => {
        const isUnlocked = unlockedSlugs.has(a.slug);
        const record     = isUnlocked ? unlockedMap.get(a.slug) : null;

        const li = document.createElement('li');
        li.className = 'ach-item-full' + (isUnlocked ? ' ach-unlocked' : ' ach-locked');

        const tierDot = document.createElement('span');
        tierDot.className         = 'ach-tier-dot';
        tierDot.style.background  = TIER_CLR[a.tier] ?? '#555';

        const iconEl = document.createElement('span');
        iconEl.className   = 'ach-icon-full';
        iconEl.textContent = a.icon || '🏆';

        const info = document.createElement('div');
        info.className = 'ach-info';

        const nm = document.createElement('span');
        nm.className   = 'ach-name-full';
        nm.textContent = a.name || a.slug;

        const desc = document.createElement('span');
        desc.className   = 'ach-desc';
        desc.textContent = a.description || '';

        info.append(nm, desc);

        const meta = document.createElement('div');
        meta.className = 'ach-meta';

        if (isUnlocked && record) {
          const check = document.createElement('span');
          check.className   = 'ach-check';
          check.textContent = '✓';
          const date = document.createElement('span');
          date.className   = 'ach-date';
          date.textContent = new Date(record.unlocked_at).toLocaleDateString('pt-BR');
          meta.append(check, date);
        } else {
          const lock = document.createElement('span');
          lock.className   = 'ach-lock';
          lock.textContent = '🔒';
          meta.append(lock);
        }

        li.append(tierDot, iconEl, info, meta);
        achList.appendChild(li);
      });
    }

    searchInput.addEventListener('input', (e) => { achSearch = e.target.value; renderAchList(); });
    tierSel.addEventListener('change',   (e) => { achTierFilter   = e.target.value; renderAchList(); });
    statusSel.addEventListener('change', (e) => { achStatusFilter = e.target.value; renderAchList(); });

    renderAchList();
    achSection.appendChild(achList);

  } else {
    // Sem catálogo — mostra apenas as conquistas desbloqueadas (simples)
    const achList = document.createElement('ul');
    achList.className = 'achievement-list';

    if (detail.achievements && detail.achievements.length > 0) {
      detail.achievements.forEach(a => {
        const li = document.createElement('li');
        li.className = 'achievement-item';

        const icon = document.createElement('span');
        icon.className   = 'ach-icon';
        icon.textContent = a.achievement_tier === 'legendary' ? '🔴'
          : a.achievement_tier === 'platinum' ? '🟣'
          : a.achievement_tier === 'gold'     ? '🥇'
          : a.achievement_tier === 'silver'   ? '🥈' : '🥉';

        const nm = document.createElement('span');
        nm.className   = 'ach-name';
        nm.textContent = a.achievement_name || a.achievement_slug;

        li.append(icon, nm);
        achList.appendChild(li);
      });
    } else {
      const li = document.createElement('li');
      li.className   = 'achievement-item';
      li.style.color = 'var(--muted)';
      li.textContent = 'Nenhuma conquista ainda.';
      achList.appendChild(li);
    }
    achSection.appendChild(achList);
  }

  div.appendChild(achSection);
  panel.appendChild(div);
}

function buildRankChart(rankPoints) {
  const W = 300, H = 56, PAD = 6;

  // Most recent 30 points, chronological order
  const pts = rankPoints.slice(0, 30).reverse();

  const maxPos = Math.max(...pts.map(h => h.rank_position));
  const minPos = Math.min(...pts.map(h => h.rank_position));
  const range  = Math.max(maxPos - minPos, 1);
  const xStep  = (W - PAD * 2) / Math.max(pts.length - 1, 1);

  const coords = pts.map((h, i) => {
    const x = PAD + i * xStep;
    // Lower rank number = better = higher on chart (smaller Y)
    const y = PAD + ((h.rank_position - minPos) / range) * (H - PAD * 2);
    return [x.toFixed(1), y.toFixed(1)];
  });

  const ns  = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width',   W);
  svg.setAttribute('height',  H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.className = 'rank-chart';

  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', W); bg.setAttribute('height', H); bg.setAttribute('fill', '#0e0e0e');
  svg.appendChild(bg);

  // Filled area under line
  const firstPt = coords[0];
  const lastPt  = coords[coords.length - 1];
  const areaPoints = coords.map(c => c.join(',')).join(' ')
    + ` ${lastPt[0]},${H} ${firstPt[0]},${H}`;
  const area = document.createElementNS(ns, 'polygon');
  area.setAttribute('points', areaPoints);
  area.setAttribute('fill',   'rgba(39,174,96,0.12)');
  svg.appendChild(area);

  // Line
  const polyline = document.createElementNS(ns, 'polyline');
  polyline.setAttribute('points',          coords.map(c => c.join(',')).join(' '));
  polyline.setAttribute('fill',            'none');
  polyline.setAttribute('stroke',          '#27ae60');
  polyline.setAttribute('stroke-width',    '1.5');
  polyline.setAttribute('stroke-linejoin', 'round');
  polyline.setAttribute('stroke-linecap',  'round');
  svg.appendChild(polyline);

  // Latest point marker
  const lx = parseFloat(lastPt[0]);
  const ly = parseFloat(lastPt[1]);
  const circle = document.createElementNS(ns, 'circle');
  circle.setAttribute('cx', lx); circle.setAttribute('cy', ly);
  circle.setAttribute('r', '3'); circle.setAttribute('fill', '#27ae60');
  svg.appendChild(circle);

  // Label: current rank
  const lastData = pts[pts.length - 1];
  const text = document.createElementNS(ns, 'text');
  text.setAttribute('x',           Math.min(lx + 4, W - PAD));
  text.setAttribute('y',           Math.max(ly - 4, PAD + 8));
  text.setAttribute('fill',        '#888');
  text.setAttribute('font-size',   '9');
  text.setAttribute('font-family', 'monospace');
  text.textContent = `#${lastData.rank_position}`;
  svg.appendChild(text);

  return svg;
}

// ── Start ─────────────────────────────────────────────────────────────────

init();
initSaves();
