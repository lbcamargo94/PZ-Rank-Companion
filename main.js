'use strict';

const {
  app, BrowserWindow, Tray, Menu, Notification,
  nativeImage, ipcMain, shell, dialog, safeStorage,
} = require('electron');
const path             = require('path');
const fs               = require('fs');
const os               = require('os');
const https            = require('https');
const http             = require('http');
const crypto           = require('crypto');
const { exec }         = require('child_process');

// Chave HMAC para assinatura dos syncs — deve coincidir com SYNC_HMAC_SECRET no backend.
// Dividida em partes para dificultar extração direta do binário.
const _hs = ['5ae8c084ea5f', 'b4e5cc1c71c8', '7ddd55eab075', '0120052ffbdb', '13abf950a045', '15e1'];
const SYNC_HMAC_SECRET = _hs.join('');

function signCode(playerToken, code) {
  return crypto.createHmac('sha256', SYNC_HMAC_SECRET)
    .update(`${playerToken}:${code}`)
    .digest('hex');
}

// electron-updater é inicializado dentro de app.whenReady() para evitar o bug
// onde require('electron-updater') acessa require('electron').app antes do runtime
// Electron interceptar o módulo (em dev, node_modules/electron exporta apenas o path).
let autoUpdater = null;

// Estado atual do update — começa em 'checking' para o banner aparecer ao abrir a janela.
// Em modo dev (não empacotado) começa em 'dev' para indicar que updates estão desativados.
let updateState = null;

function setUpdateState(state) {
  updateState = state;
  sendToRenderer('update-status', state);
}

function initAutoUpdater() {
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    console.error('[updater] falha ao carregar electron-updater:', e.message);
    return;
  }

  autoUpdater.autoDownload         = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = {
    info:  (m) => console.log('[updater]', m),
    warn:  (m) => console.warn('[updater]', m),
    error: (m) => console.error('[updater]', m),
    debug: () => {},
  };

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({ phase: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    setUpdateState({ phase: 'available', version: info.version });
    notify('Atualização disponível!', `Versão ${info.version} pronta para download.`, 'system');
    autoUpdater.downloadUpdate();
  });
  autoUpdater.on('update-not-available', () => {
    setUpdateState({ phase: 'up-to-date' });
  });
  autoUpdater.on('download-progress', (p) => {
    setUpdateState({ phase: 'downloading', percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    setUpdateState({ phase: 'downloaded', version: info.version });
    notify('Atualização pronta!', `Versão ${info.version} baixada. Clique para instalar.`, 'system');
    updateTray();
  });
  autoUpdater.on('error', (err) => {
    const msg = err.message || String(err);
    setUpdateState({ phase: 'error', message: msg });
    console.error('[updater]', msg);
  });
}

// ── Config ────────────────────────────────────────────────────────────────

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

// Criptografa o playerToken com a API nativa do SO (DPAPI no Windows,
// Keychain no macOS, secret store no Linux). Se não disponível, retorna
// o valor em texto claro como fallback (mesma situação de antes da correção).
function encryptToken(token) {
  if (!token) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(token).toString('base64');
    }
  } catch (e) {
    console.warn('[safeStorage] falha ao criptografar token:', e.message);
  }
  return token;
}

function decryptToken(value) {
  if (!value) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(value, 'base64'));
    }
  } catch {
    // valor pode ser texto claro de versão anterior — retorna como está
  }
  return value;
}

// apiUrl: selecionada automaticamente — produção quando empacotado, local em desenvolvimento.
const PROD_API_URL  = 'https://pz-rank-backend.vercel.app';
const DEV_API_URL   = 'http://localhost:3000';
const PROD_SITE_URL = 'https://pzrank.com.br';

const DEFAULT_CONFIG = {
  nick:          '',
  playerToken:   '',
  playerId:      '',
  apiUrl:        app.isPackaged ? PROD_API_URL : DEV_API_URL,
  watchDir:      path.join(os.homedir(), 'Zomboid', 'Lua', 'pz_rank'),
  autostart:     false,
  notifications: 'all', // 'all' | 'errors-only' | 'none'
  savedProfiles: [], // [{ nick, playerTokenEncrypted, playerId }]
};

let config = { ...DEFAULT_CONFIG };

function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
    delete saved.apiUrl; // apiUrl não é configurável pelo usuário — sempre usa o default
    // Migração: se o token estava em texto claro (versões anteriores),
    // descriptografa o campo novo ou mantém o plaintext como fallback.
    if (saved.playerTokenEncrypted !== undefined) {
      saved.playerToken = decryptToken(saved.playerTokenEncrypted);
      delete saved.playerTokenEncrypted;
    }
    return { ...DEFAULT_CONFIG, ...saved };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig() {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Nunca salva o token em texto claro — usa safeStorage (criptografia do SO).
  const toSave = { ...config };
  toSave.playerTokenEncrypted = encryptToken(config.playerToken);
  delete toSave.playerToken;
  fs.writeFileSync(p, JSON.stringify(toSave, null, 2), 'utf-8');
}

// Salva o perfil ativo na lista de perfis salvos (cria ou atualiza por nick).
function saveCurrentProfileToList() {
  if (!config.nick || !config.playerToken) return;
  const profiles = config.savedProfiles || [];
  const idx      = profiles.findIndex(p => p.nick.toLowerCase() === config.nick.toLowerCase());
  const entry    = { nick: config.nick, playerTokenEncrypted: encryptToken(config.playerToken), playerId: config.playerId || '' };
  if (idx >= 0) profiles[idx] = entry; else profiles.push(entry);
  config.savedProfiles = profiles;
}

// ── State ─────────────────────────────────────────────────────────────────

let tray            = null;
let mainWindow      = null;
let watcher         = null;
let lastSync        = null;    // { ts, characterName, score }
let syncHistory     = [];      // últimos 10 syncs [ { ts, characterName, score, ok } ]
let syncStatus      = 'idle';  // 'idle' | 'syncing' | 'ok' | 'error'
let watcherError    = null;    // null = ok, string = mensagem de erro
let gameRunning     = false;   // true se ProjectZomboid64.exe está em execução
let lastRankFileTime = null;   // timestamp do último arquivo PZR processado
let modOutdated      = false;  // true quando backend retorna 426 (mod desatualizado)

function historyPath() {
  return path.join(app.getPath('userData'), 'sync-history.json');
}

function loadHistory() {
  try {
    const saved = JSON.parse(fs.readFileSync(historyPath(), 'utf-8'));
    if (Array.isArray(saved)) syncHistory = saved.slice(0, 10);
  } catch { /* primeira execução — começa vazio */ }
  if (syncHistory.length > 0) lastSync = syncHistory.find(h => h.ok) ?? null;
}

function pushHistory(entry) {
  syncHistory.unshift(entry);
  if (syncHistory.length > 10) syncHistory.length = 10;
  try { fs.writeFileSync(historyPath(), JSON.stringify(syncHistory, null, 2), 'utf-8'); } catch {}
}

// ── Retry queue ───────────────────────────────────────────────────────────

const QUEUE_MAX_AGE     = 24 * 60 * 60 * 1000; // descarta após 24h
const QUEUE_MAX_RETRIES = 10;                    // descarta após 10 tentativas
const RETRY_DELAYS_MS   = [5, 10, 20, 40, 60].map(m => m * 60 * 1000); // backoff exponencial

function retryDelayFor(retries) {
  return RETRY_DELAYS_MS[Math.min(retries, RETRY_DELAYS_MS.length - 1)];
}

function queuePath() {
  return path.join(app.getPath('userData'), 'pending-syncs.json');
}

function loadQueue() {
  try { return JSON.parse(fs.readFileSync(queuePath(), 'utf-8')); } catch { return []; }
}

function saveQueue(queue) {
  try { fs.writeFileSync(queuePath(), JSON.stringify(queue, null, 2), 'utf-8'); } catch {}
}

function enqueue(code, disqualification_reason = null) {
  const queue = loadQueue();
  if (queue.some(i => i.code === code)) return;
  queue.push({ code, disqualification_reason, addedAt: Date.now(), retries: 0, nextRetryAt: Date.now() + retryDelayFor(0) });
  saveQueue(queue);
  console.log('[queue] adicionado:', code.slice(0, 20) + '…');
}

async function retryQueue() {
  if (!config.playerToken) return;
  const now   = Date.now();
  const queue = loadQueue();
  if (queue.length === 0) return;

  // Descarta itens expirados antes de tentar reenviar
  const valid = queue.filter(i => {
    if (now - i.addedAt > QUEUE_MAX_AGE) {
      console.warn('[queue] expirado (>24h), descartado:', i.code.slice(0, 20) + '…');
      return false;
    }
    if ((i.retries ?? 0) >= QUEUE_MAX_RETRIES) {
      console.warn('[queue] excedeu tentativas, descartado:', i.code.slice(0, 20) + '…');
      return false;
    }
    return true;
  });

  const due       = valid.filter(i => now >= (i.nextRetryAt ?? 0));
  const notDue    = valid.filter(i => now <  (i.nextRetryAt ?? 0));
  const remaining = [...notDue];

  if (due.length === 0) return;
  console.log(`[queue] tentando reenviar ${due.length} item(s) (${notDue.length} aguardando backoff)`);

  for (const item of due) {
    try {
      const result = await postSync(config.playerToken, item.code, item.disqualification_reason ?? null);
      const syncEntry = { ts: Date.now(), characterName: result.character_name, score: result.score, rankPosition: result.rank_position ?? null, ok: true, disqualificationReason: item.disqualification_reason ?? null };
      lastSync   = syncEntry;
      syncStatus = 'ok';
      if (modOutdated) modOutdated = false;
      pushHistory(syncEntry);
      notify('✓ Sync recuperado!', result.character_name
        ? `${result.character_name}  •  ${result.score ?? 0} pts`
        : 'Rank atualizado!', 'sync-ok');
      updateTray();
      sendToRenderer('status-update', getStatusPayload());
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        config.playerToken = '';
        saveConfig();
        showMainWindow();
        remaining.push(...due.slice(due.indexOf(item) + 1)); // preserva os restantes
        break;
      }
      if (err.status === 426) {
        modOutdated = true;
        notify('⚠ Mod desatualizado', 'Atualize o mod PZ Community Rank na Oficina da Steam.', 'system');
        break; // não adianta tentar os outros itens da fila — todos falharão
      }
      const retries = (item.retries ?? 0) + 1;
      remaining.push({ ...item, retries, nextRetryAt: Date.now() + retryDelayFor(retries) });
      console.log(`[queue] falhou (tentativa ${retries}), próxima em ${retryDelayFor(retries) / 60000}min`);
    }
  }

  saveQueue(remaining);
  sendToRenderer('status-update', getStatusPayload());
}

// ── App lifecycle ─────────────────────────────────────────────────────────

app.setName('PZ Rank Companion');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', () => mainWindow && (mainWindow.show(), mainWindow.focus()));

app.whenReady().then(() => {
  config = loadConfig();
  loadHistory();
  app.setAppUserModelId('com.pzrank.companion');
  createTray();
  applyAutostart();
  startWatcher();
  checkGameRunning();
  setInterval(checkGameRunning, 30_000);
  retryQueue();
  setInterval(retryQueue, 5 * 60_000);
  fetchAndWriteAllowedMods();
  setInterval(fetchAndWriteAllowedMods, 60 * 60_000); // atualiza whitelist a cada 1h

  // Heartbeat de detecção de mod removido: a cada 5min verifica se o jogo está
  // rodando mas nenhum arquivo PZR foi gerado nos últimos 30min → mod removido.
  // Threshold de 30min cobre: jogo pausado, jogador explorando sem kills/levelups,
  // ou salvamento automático sem mudança de estado (deduplicação do mod v2.3.9).
  // Mods v2.5.0+ incluem timestamp no código e sempre geram arquivo a cada 5min.
  setInterval(checkModHeartbeat, 5 * 60_000);
  if (!config.playerToken) showMainWindow();

  // initAutoUpdater deve ser chamado aqui (pós-whenReady) para que
  // require('electron-updater') acesse require('electron').app corretamente.
  initAutoUpdater();

  if (app.isPackaged) {
    setUpdateState({ phase: 'checking' });
    setTimeout(() => autoUpdater && autoUpdater.checkForUpdates().catch((err) => {
      setUpdateState({ phase: 'error', message: err.message || String(err) });
    }), 4000);
    setInterval(() => autoUpdater && autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60_000);
  } else {
    setUpdateState({ phase: 'dev' });
  }
});

app.on('window-all-closed', (e) => e.preventDefault());

// ── Tray ──────────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray.png');
  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('empty');
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('PZ Rank Companion');
  tray.on('double-click', showMainWindow);
  updateTray();
}

function updateTray() {
  if (!tray) return;

  const statusLine = config.playerToken ? `● ${config.nick}` : '○ Não configurado';
  const gameLine   = gameRunning ? '▶ Jogo ativo' : '◻ Jogo não detectado';
  const syncLine   = lastSync ? `Último sync: ${timeAgo(lastSync.ts)}` : 'Aguardando arquivo do mod...';

  const menu = Menu.buildFromTemplate([
    { label: 'PZ Rank Companion', enabled: false },
    { type: 'separator' },
    { label: statusLine, enabled: false },
    { label: gameLine,   enabled: false },
    { label: syncLine,   enabled: false },
    { type: 'separator' },
    { label: 'Abrir',           click: showMainWindow },
    { label: 'Sincronizar agora', click: triggerManualSync, enabled: !!config.playerToken },
    { type: 'separator' },
    {
      label:   'Iniciar com Windows',
      type:    'checkbox',
      checked: config.autostart,
      click:   toggleAutostart,
    },
    { type: 'separator' },
    { label: 'Sair', click: () => { watcher?.close(); app.exit(0); } },
  ]);
  tray.setContextMenu(menu);
}

// ── Main window ───────────────────────────────────────────────────────────

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width:          460,
    height:         560,
    minWidth:       380,
    minHeight:      480,
    resizable:      true,
    maximizable:    true,
    title:          'PZ Rank Companion',
    icon:           path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload:             path.join(__dirname, 'preload.js'),
      contextIsolation:    true,
      nodeIntegration:     false,
      backgroundThrottling: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenu(null);
  mainWindow.on('close', (e) => { e.preventDefault(); mainWindow.hide(); });
  // Envia o estado atual do update assim que o renderer estiver pronto
  mainWindow.webContents.once('did-finish-load', () => {
    if (updateState) mainWindow.webContents.send('update-status', updateState);
  });
}

// ── File watcher ──────────────────────────────────────────────────────────

function startWatcher() {
  watcher?.close();
  watcher      = null;
  watcherError = null;

  try {
    fs.mkdirSync(config.watchDir, { recursive: true });
  } catch (err) {
    watcherError = `Não foi possível acessar a pasta: ${err.message}`;
    sendToRenderer('status-update', getStatusPayload());
    return;
  }

  const chokidar = require('chokidar');
  watcher = chokidar.watch(config.watchDir, {
    persistent:       true,
    ignoreInitial:    true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  watcher.on('ready', () => {
    watcherError = null;
    sendToRenderer('status-update', getStatusPayload());
  });

  const onFile = (filePath) => {
    const ext  = path.extname(filePath).toLowerCase();
    const base = path.basename(filePath);
    if (ext === '.txt' && base !== 'pz_rank_allowed_mods.txt') {
      lastRankFileTime = Date.now();
      // Captura o conteúdo imediatamente (síncrono) antes de qualquer operação async.
      // Isso fecha a janela onde um jogador poderia deletar o arquivo entre o evento
      // do watcher e a leitura efetiva, perdendo dados de violação.
      let content;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch {
        console.warn('[sync] arquivo desapareceu antes da leitura:', filePath);
        return;
      }
      handleNewRankFileContent(content, filePath);
    } else if (ext === '.json' && base.startsWith('pz_rank_sandbox_')) {
      handleNewSandboxFile(filePath);
    }
  };
  watcher.on('add',    onFile);
  watcher.on('change', onFile);

  watcher.on('error', (err) => {
    watcherError = err.message;
    console.error('[watcher]', err);
    sendToRenderer('status-update', getStatusPayload());
  });
}

// ── Sync ──────────────────────────────────────────────────────────────────

async function triggerManualSync() {
  if (!config.playerToken) return { success: false, error: 'Jogador não conectado.' };
  try {
    const files = fs.readdirSync(config.watchDir)
      .filter(f => f.endsWith('.txt') && f !== 'pz_rank_allowed_mods.txt')
      .map(f => { const fp = path.join(config.watchDir, f); return { fp, mtime: fs.statSync(fp).mtimeMs }; })
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length === 0) return { success: false, error: 'Nenhum arquivo de rank encontrado na pasta.' };
    const content = fs.readFileSync(files[0].fp, 'utf-8');
    await handleNewRankFileContent(content, files[0].fp);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function extractCodeFromContent(content) {
  try {
    const lines = content.split('\n').map(l => l.trim());

    // Localiza o índice do último código PZRX2 ou PZRX3
    let lastCodeIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].startsWith('PZRX2:') || lines[i].startsWith('PZRX3:')) { lastCodeIdx = i; break; }
    }

    if (lastCodeIdx >= 0) {
      // Procura a linha "Motivo    :" no mesmo bloco (entre o header anterior e o código)
      let disqualification_reason = null;
      for (let i = lastCodeIdx - 1; i >= 0; i--) {
        if (lines[i].startsWith('Motivo    :')) {
          const val = lines[i].slice('Motivo    :'.length).trim();
          if (val) disqualification_reason = val;
          break;
        }
        if (lines[i].startsWith('=== PZ Community Rank ===')) break;
      }
      return { code: lines[lastCodeIdx], legacy: false, disqualification_reason };
    }

    const pzrx1 = lines.filter(l => l.startsWith('PZRX1:'));
    if (pzrx1.length > 0) return { code: pzrx1[pzrx1.length - 1], legacy: true };
    return null;
  } catch {
    return null;
  }
}

async function handleNewRankFileContent(content, filePath) {
  console.log('[sync] processando arquivo:', filePath);

  if (!config.playerToken) {
    notify('PZ Rank', 'Arquivo detectado — configure o jogador no app.', 'system');
    showMainWindow();
    return;
  }

  const extracted = extractCodeFromContent(content);
  if (!extracted) { console.warn('[sync] nenhum código encontrado no arquivo'); return; }
  if (extracted.legacy) {
    console.warn('[sync] código PZRX1 detectado — mod desatualizado');
    notify('⚠ Mod desatualizado', 'Atualize o mod PZ Rank para sincronizar automaticamente.', 'sync-error');
    return;
  }
  const code                   = extracted.code;
  const disqualification_reason = extracted.disqualification_reason ?? null;
  const charName               = charNameFromFilePath(filePath);
  const heatmap_delta          = readHeatmapDelta(charName);

  syncStatus = 'syncing';
  sendToRenderer('status-update', getStatusPayload());

  try {
    const result = await postSync(config.playerToken, code, disqualification_reason, heatmap_delta);

    const syncEntry = { ts: Date.now(), characterName: result.character_name, score: result.score, rankPosition: result.rank_position ?? null, ok: true, disqualificationReason: disqualification_reason ?? null };
    lastSync   = syncEntry;
    syncStatus = 'ok';
    if (modOutdated) modOutdated = false;
    pushHistory(syncEntry);

    const body = result.character_name
      ? `${result.character_name}  •  ${result.score ?? 0} pts`
      : 'Rank atualizado!';
    notify('✓ Rank sincronizado!', body, 'sync-ok');

    // Após o rank ser gravado no DB, envia o sandbox do mesmo personagem.
    // Necessário porque os dois arquivos são gerados quase ao mesmo tempo e
    // o sandbox pode chegar ao backend antes da entrada existir (race condition).
    trySendSandboxForCharacter(result.character_name).catch(() => {});
  } catch (err) {
    syncStatus = 'error';
    pushHistory({ ts: Date.now(), characterName: null, score: null, ok: false, error: err.message });
    console.error('[sync] erro:', err.message);

    if (err.status === 401 || err.status === 403) {
      config.playerToken = '';
      saveConfig();
      showMainWindow();
      notify('✗ Sessão expirada', 'Reconecte o jogador no app.', 'system');
    } else if (err.status === 426) {
      modOutdated = true;
      notify('⚠ Mod desatualizado', 'Atualize o mod PZ Community Rank na Oficina da Steam para continuar sincronizando.', 'system');
    } else {
      enqueue(code, disqualification_reason);
      notify('✗ Falha no sync', 'Salvo na fila — será reenviado automaticamente.', 'sync-error');
    }
  }

  updateTray();
  sendToRenderer('status-update', getStatusPayload());
}

// ── Sandbox sync ─────────────────────────────────────────────────────────────

// Replica o sanitizeName do Lua: remove chars inválidos e troca espaços por _
function sanitizeCharName(name) {
  if (!name) return 'Sobrevivente';
  const s = name.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_');
  return s || 'Sobrevivente';
}

// Após o rank sync ter sucesso, tenta enviar o arquivo sandbox do mesmo personagem.
// Garante que a entrada já existe no DB quando o sandbox chega — evita a race condition
// onde sandbox e rank são gerados ao mesmo tempo e o sandbox POST chega primeiro.
async function trySendSandboxForCharacter(characterName) {
  const safeName    = sanitizeCharName(characterName);
  const sandboxPath = path.join(config.watchDir, `pz_rank_sandbox_${safeName}.json`);
  if (!fs.existsSync(sandboxPath)) return;
  console.log('[sandbox] enviando após rank sync:', sandboxPath);
  await handleNewSandboxFile(sandboxPath);
}

async function handleNewSandboxFile(filePath) {
  console.log('[sandbox] arquivo detectado:', filePath);
  if (!config.playerToken) return;

  let sandboxData;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    sandboxData = JSON.parse(content);
  } catch (err) {
    console.error('[sandbox] erro ao ler/parsear:', err.message);
    return;
  }

  if (!sandboxData || sandboxData.type !== 'sandbox_config') {
    console.warn('[sandbox] ignorado — type !== sandbox_config');
    return;
  }

  try {
    await postSandbox(config.playerToken, sandboxData);
    console.log('[sandbox] enviado com sucesso');
  } catch (err) {
    // Sandbox é best-effort — falha silenciosa, nao afeta o rank
    console.error('[sandbox] falha ignorada:', err.message);
  }
}

function postSandbox(playerToken, sandboxData) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ player_token: playerToken, sandbox_config: sandboxData });
    const u    = new URL(config.apiUrl + '/sync/sandbox');
    const lib  = u.protocol === 'https:' ? https : http;
    const req  = lib.request(
      {
        hostname: u.hostname,
        port:     u.port || (u.protocol === 'https:' ? 443 : 80),
        path:     u.pathname,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json);
            const err  = new Error(json.error || ('HTTP ' + res.statusCode));
            err.status = res.statusCode;
            reject(err);
          } catch { reject(new Error('Resposta invalida do servidor')); }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(15_000, () => { req.destroy(); reject(new Error('Timeout (15s)')); });
    req.write(body);
    req.end();
  });
}

// Detecta se o mod foi removido: jogo rodando há 30min+ sem gerar arquivos PZR.
// Envia sinal ao backend para desclassificar a run ativa do jogador.
// Após disparar, limpa lastRankFileTime para exigir novo arquivo antes de disparar de novo.
async function checkModHeartbeat() {
  if (!config.playerToken || !gameRunning) return;
  if (!lastRankFileTime) return; // nunca viu arquivo — pode ser primeira execução
  const silentMs = Date.now() - lastRankFileTime;
  if (silentMs < 30 * 60_000) return; // menos de 30min sem arquivo — ainda ok

  // Limpa para não disparar novamente até que o mod gere um novo arquivo
  lastRankFileTime = null;

  try {
    await postRequest(`${config.apiUrl}/sync/heartbeat`, {
      player_token:    config.playerToken,
      no_mod_detected: true,
    });
    console.log('[heartbeat] Mod removido detectado — run desclassificada pelo backend.');
    sendToRenderer('status-update', getStatusPayload());
  } catch (err) {
    console.error('[heartbeat] Falha ao enviar sinal de mod removido:', err.message);
  }
}

// Busca a lista de mods permitidos no backend e escreve pz_rank_allowed_mods.txt
// na pasta watchDir para que o mod Lua possa ler via getFileReader.
async function fetchAndWriteAllowedMods() {
  try {
    const url    = `${config.apiUrl}/sync/allowed-mods`;
    const result = await getRequest(url);
    const mods   = (result.mods ?? []).filter(m => m.mod_id);

    const lines = [
      '# PZ Community Rank - whitelist de mods permitidos',
      `# Atualizado: ${new Date().toISOString()}`,
      '',
    ];
    for (const m of mods) {
      lines.push((m.is_required ? 'REQUIRE:' : 'ALLOW:') + m.mod_id);
    }

    const outPath = path.join(config.watchDir, 'pz_rank_allowed_mods.txt');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf-8');
    console.log(`[mods] whitelist atualizada: ${mods.length} mod(s) -> ${outPath}`);
  } catch (err) {
    console.warn('[mods] falha ao buscar allowed-mods:', err.message);
  }
}

function writeClearViolation() {
  const outPath = path.join(config.watchDir, 'pz_rank_clear_violation.txt');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, 'clear', 'utf-8');
  console.log('[violation] arquivo de limpeza escrito:', outPath);
}

// Deriva o nome sanitizado do personagem a partir do caminho do arquivo .txt.
// ex: pz_rank_Liana.txt → "Liana"
function charNameFromFilePath(filePath) {
  const base = path.basename(filePath, '.txt');
  return base.startsWith('pz_rank_') ? base.slice('pz_rank_'.length) : null;
}

// Tenta ler o arquivo de heatmap delta correspondente ao personagem.
// Retorna array de pontos ou null se ausente/inválido.
function readHeatmapDelta(charName) {
  if (!charName) return null;
  const heatmapPath = path.join(config.watchDir, `pz_rank_heatmap_${charName}.json`);
  try {
    const data = JSON.parse(fs.readFileSync(heatmapPath, 'utf-8'));
    return Array.isArray(data) && data.length > 0 ? data : null;
  } catch { return null; }
}

function postSync(playerToken, code, disqualificationReason = null, heatmapDelta = null) {
  return new Promise((resolve, reject) => {
    const payload = { player_token: playerToken, code };
    if (disqualificationReason) payload.disqualification_reason = disqualificationReason;
    if (heatmapDelta && heatmapDelta.length > 0) payload.heatmap_delta = heatmapDelta;
    const body = JSON.stringify(payload);
    const u    = new URL(config.apiUrl + '/sync/update');
    const lib  = u.protocol === 'https:' ? https : http;

    const req = lib.request(
      {
        hostname: u.hostname,
        port:     u.port || (u.protocol === 'https:' ? 443 : 80),
        path:     u.pathname,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Code-Sig':     signCode(playerToken, code),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode === 200 || res.statusCode === 201) return resolve(json);
            const err = new Error(json.error || `HTTP ${res.statusCode}`);
            err.status = res.statusCode;
            reject(err);
          } catch {
            reject(new Error('Resposta inválida do servidor'));
          }
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('Timeout (10s)')); });
    req.write(body);
    req.end();
  });
}

// ── IPC handlers ──────────────────────────────────────────────────────────

ipcMain.handle('get-status', () => getStatusPayload());

ipcMain.handle('get-config', () => ({
  nick:          config.nick,
  watchDir:      config.watchDir,
  autostart:     config.autostart,
  notifications: config.notifications || 'all',
  savedProfiles: (config.savedProfiles || []).map(p => ({ nick: p.nick, playerId: p.playerId || '' })),
}));

ipcMain.handle('lookup-player', async (_, nick) => {
  try {
    const url    = `${config.apiUrl}/sync/lookup?nick=${encodeURIComponent(nick)}`;
    const result = await getRequest(url);
    if (!result.player_token) throw new Error(result.error || 'Jogador não encontrado ou não aprovado');
    saveCurrentProfileToList();
    config.nick        = nick;
    config.playerToken = result.player_token;
    if (result.player_id) config.playerId = result.player_id;
    saveCurrentProfileToList();
    saveConfig();
    updateTray();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('login-player', async (_, { email, password }) => {
  try {
    const result = await postRequest(`${config.apiUrl}/auth/player/login`, { email, password });
    if (!result.player_token) throw new Error(result.error || 'Credenciais inválidas.');
    saveCurrentProfileToList();
    config.nick        = result.nick || email;
    config.playerToken = result.player_token;
    config.playerId    = result.player_id || '';
    saveCurrentProfileToList();
    saveConfig();
    updateTray();
    return { success: true, nick: result.nick };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-settings', (_, { watchDir, notifications }) => {
  const dirChanged = watchDir && watchDir !== config.watchDir;
  if (watchDir) config.watchDir = watchDir;
  if (notifications !== undefined) config.notifications = notifications;
  saveConfig();
  if (dirChanged) startWatcher(); // só reinicia watcher se a pasta mudou
  updateTray();
  return { success: true };
});

ipcMain.handle('toggle-autostart', (_, enabled) => {
  config.autostart = enabled;
  saveConfig();
  applyAutostart();
  updateTray();
  return { success: true };
});

ipcMain.handle('disconnect', () => {
  saveCurrentProfileToList(); // salva antes de limpar
  config.nick        = '';
  config.playerToken = '';
  config.playerId    = '';
  saveConfig();
  updateTray();
  sendToRenderer('status-update', getStatusPayload());
  return { success: true };
});

ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

ipcMain.handle('open-site', () => shell.openExternal(PROD_SITE_URL));

ipcMain.handle('open-profile', () => {
  if (config.playerId) shell.openExternal(`${PROD_SITE_URL}/player/${config.playerId}`);
});

ipcMain.handle('manual-sync', () => triggerManualSync());

ipcMain.handle('clear-violation', () => {
  try {
    writeClearViolation();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('clear-history', () => {
  syncHistory = [];
  lastSync    = null;
  try { fs.writeFileSync(historyPath(), '[]', 'utf-8'); } catch {}
  sendToRenderer('status-update', getStatusPayload());
  return { success: true };
});

ipcMain.handle('switch-profile', (_, nick) => {
  const profiles = config.savedProfiles || [];
  const profile  = profiles.find(p => p.nick.toLowerCase() === nick.toLowerCase());
  if (!profile) return { success: false, error: 'Perfil não encontrado.' };
  saveCurrentProfileToList();
  config.nick        = profile.nick;
  config.playerToken = decryptToken(profile.playerTokenEncrypted);
  config.playerId    = profile.playerId || '';
  saveConfig();
  updateTray();
  sendToRenderer('status-update', getStatusPayload());
  return { success: true };
});

ipcMain.handle('remove-profile', (_, nick) => {
  config.savedProfiles = (config.savedProfiles || []).filter(
    p => p.nick.toLowerCase() !== nick.toLowerCase(),
  );
  saveConfig();
  return { success: true };
});

ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged || !autoUpdater) {
    sendToRenderer('update-status', { phase: 'dev' });
    return;
  }
  try { await autoUpdater.checkForUpdates(); }
  catch (err) { sendToRenderer('update-status', { phase: 'error', message: err.message }); }
});

ipcMain.handle('install-update', () => {
  if (autoUpdater) autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('get-app-version',    () => app.getVersion());
ipcMain.handle('get-update-status', () => updateState);

ipcMain.handle('pick-folder', async () => {
  const defaultPath = fs.existsSync(config.watchDir) ? config.watchDir : os.homedir();
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    properties:  ['openDirectory'],
    title:       'Selecione a pasta dos arquivos do mod PZ Rank',
    defaultPath,
  });
  if (!result.canceled && result.filePaths.length > 0) {
    config.watchDir = result.filePaths[0];
    saveConfig();
    startWatcher();
    return { success: true, path: config.watchDir };
  }
  return { success: false };
});

// ── Helpers ───────────────────────────────────────────────────────────────

function getStatusPayload() {
  return {
    connected:      !!config.playerToken,
    nick:           config.nick,
    syncStatus,
    lastSync,
    syncHistory,
    pendingQueue:   loadQueue().length,
    watchDir:       config.watchDir,
    watchDirExists: fs.existsSync(config.watchDir),
    watcherError,
    gameRunning,
    hasProfile:     !!config.playerId,
    notifications:  config.notifications || 'all',
    modOutdated,
  };
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
}

function getRequest(url) {
  return new Promise((resolve, reject) => {
    const u   = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    lib.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else { const e = new Error(json.error || `HTTP ${res.statusCode}`); e.status = res.statusCode; reject(e); }
        } catch { reject(new Error('Resposta inválida')); }
      });
    }).on('error', reject);
  });
}

function postRequest(url, body) {
  return new Promise((resolve, reject) => {
    const u       = new URL(url);
    const lib     = u.protocol === 'https:' ? https : http;
    const payload = JSON.stringify(body);
    const options = {
      hostname: u.hostname,
      path:     u.pathname + u.search,
      port:     u.port || (u.protocol === 'https:' ? 443 : 80),
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else { const e = new Error(json.error || `HTTP ${res.statusCode}`); e.status = res.statusCode; reject(e); }
        } catch { reject(new Error('Resposta inválida')); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// type: 'sync-ok' | 'sync-error' | 'system'
// 'system' sempre mostra; 'sync-ok' bloqueado por 'errors-only'/'none'; 'sync-error' bloqueado por 'none'
function notify(title, body, type = 'sync-ok') {
  if (!Notification.isSupported()) return;
  const n = config.notifications || 'all';
  if (n === 'none'        && type !== 'system') return;
  if (n === 'errors-only' && type !== 'sync-error' && type !== 'system') return;
  new Notification({ title, body }).show();
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'agora mesmo';
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  return `há ${Math.floor(m / 60)}h`;
}

function applyAutostart() {
  app.setLoginItemSettings({ openAtLogin: config.autostart, name: 'PZ Rank Companion' });
}

function toggleAutostart() {
  config.autostart = !config.autostart;
  saveConfig();
  applyAutostart();
  updateTray();
}

function checkGameRunning() {
  // Steam launch: ProjectZomboid64.exe está visível no tasklist.
  // Bat file / modo janela: o wrapper .exe não aparece — o processo real é
  // java.exe em <pasta do PZ>/jre64/bin/java.exe. Verificamos os dois casos.
  exec('tasklist /FI "IMAGENAME eq ProjectZomboid64.exe" /NH /FO CSV 2>NUL', (err, stdout) => {
    if (!err && stdout.toLowerCase().includes('projectzomboid64.exe')) {
      applyGameRunning(true);
      return;
    }
    // Fallback: verifica java.exe cujo caminho contém "ProjectZomboid"
    exec(
      'powershell -NoProfile -NonInteractive -Command "if (Get-Process java -ErrorAction SilentlyContinue | Where-Object { $_.Path -like \'*ProjectZomboid*\' }) { \'found\' }"',
      (_e, out) => applyGameRunning(out.includes('found')),
    );
  });
}

function applyGameRunning(running) {
  if (running !== gameRunning) {
    gameRunning = running;
    // Modo jogo: enquanto PZ está rodando, reduz o Chromium para 1fps.
    // Elimina a disputa de CPU entre o renderer do Electron e o jogo.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.setFrameRate(running ? 1 : 60);
    }
    updateTray();
    sendToRenderer('status-update', getStatusPayload());
  }
}