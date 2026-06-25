'use strict';

const {
  app, BrowserWindow, Tray, Menu, Notification,
  nativeImage, ipcMain, shell, dialog,
} = require('electron');
const path             = require('path');
const fs               = require('fs');
const os               = require('os');
const https            = require('https');
const http             = require('http');
const { exec }         = require('child_process');
const { autoUpdater }  = require('electron-updater');

// ── Auto-updater config ───────────────────────────────────────────────────
autoUpdater.autoDownload         = false; // disparo manual via downloadUpdate() no evento update-available
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.logger               = null;  // sem log verboso em produção

// Estado atual do update (mantido em memória para o renderer buscar ao abrir a janela)
let updateState = null; // { phase, version?, percent?, message? }

function setUpdateState(state) {
  updateState = state;
  sendToRenderer('update-status', state);
}

autoUpdater.on('checking-for-update', () => {
  setUpdateState({ phase: 'checking' });
});
autoUpdater.on('update-available', (info) => {
  setUpdateState({ phase: 'available', version: info.version });
  notify('Atualização disponível!', `Versão ${info.version} pronta para download.`);
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
  notify('Atualização pronta!', `Versão ${info.version} baixada. Clique para instalar.`);
  updateTray();
});
autoUpdater.on('error', (err) => {
  const msg = err.message || String(err);
  setUpdateState({ phase: 'error', message: msg });
  console.error('[updater]', msg);
});

// ── Config ────────────────────────────────────────────────────────────────

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

// apiUrl: selecionada automaticamente — produção quando empacotado, local em desenvolvimento.
const PROD_API_URL = 'https://pz-rank-backend.vercel.app';
const DEV_API_URL  = 'http://localhost:3000';

const DEFAULT_CONFIG = {
  nick:        '',
  playerToken: '',
  apiUrl:      app.isPackaged ? PROD_API_URL : DEV_API_URL,
  watchDir:    path.join(os.homedir(), 'Zomboid', 'Lua', 'pz_rank'),
  autostart:   false,
};

let config = { ...DEFAULT_CONFIG };

function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
    delete saved.apiUrl; // apiUrl não é configurável pelo usuário — sempre usa o default
    return { ...DEFAULT_CONFIG, ...saved };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig() {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf-8');
}

// ── State ─────────────────────────────────────────────────────────────────

let tray         = null;
let mainWindow   = null;
let watcher      = null;
let lastSync     = null;    // { ts, characterName, score }
let syncStatus   = 'idle';  // 'idle' | 'syncing' | 'ok' | 'error'
let watcherError = null;    // null = ok, string = mensagem de erro
let gameRunning  = false;   // true se ProjectZomboid64.exe está em execução

// ── Retry queue ───────────────────────────────────────────────────────────

function queuePath() {
  return path.join(app.getPath('userData'), 'pending-syncs.json');
}

function loadQueue() {
  try { return JSON.parse(fs.readFileSync(queuePath(), 'utf-8')); } catch { return []; }
}

function saveQueue(queue) {
  try { fs.writeFileSync(queuePath(), JSON.stringify(queue, null, 2), 'utf-8'); } catch {}
}

function enqueue(code) {
  const queue = loadQueue();
  if (queue.some(i => i.code === code)) return;  // já está na fila
  queue.push({ code, addedAt: Date.now() });
  saveQueue(queue);
  console.log('[queue] adicionado:', code.slice(0, 20) + '…');
}

async function retryQueue() {
  if (!config.playerToken) return;
  const queue = loadQueue();
  if (queue.length === 0) return;

  console.log(`[queue] tentando reenviar ${queue.length} item(s)`);
  const remaining = [];

  for (const item of queue) {
    try {
      const result = await postSync(config.playerToken, item.code);
      lastSync   = { ts: Date.now(), characterName: result.character_name, score: result.score };
      syncStatus = 'ok';
      notify('✓ Sync recuperado!', result.character_name
        ? `${result.character_name}  •  ${result.score ?? 0} pts`
        : 'Rank atualizado!');
      updateTray();
      sendToRenderer('status-update', getStatusPayload());
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        config.playerToken = '';
        saveConfig();
        showMainWindow();
        break;
      }
      remaining.push(item);
    }
  }

  saveQueue(remaining);
}

// ── App lifecycle ─────────────────────────────────────────────────────────

app.setName('PZ Rank Companion');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', () => mainWindow && (mainWindow.show(), mainWindow.focus()));

app.whenReady().then(() => {
  config = loadConfig();
  app.setAppUserModelId('com.pzrank.companion');
  createTray();
  applyAutostart();
  startWatcher();
  checkGameRunning();
  setInterval(checkGameRunning, 30_000);
  retryQueue();
  setInterval(retryQueue, 5 * 60_000);
  if (!config.playerToken) showMainWindow();

  // Verificar atualizações ao iniciar (somente no build empacotado)
  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 4000);
    // Re-verifica a cada 4 horas
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60_000);
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
    { label: 'Abrir', click: showMainWindow },
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
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
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
    if (ext === '.txt') {
      handleNewRankFile(filePath);
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

function extractCode(filePath) {
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    // Lê o ÚLTIMO código — arquivo acumula histórico, o mais recente fica no final
    const pzrLines = lines.map(l => l.trim()).filter(l => l.startsWith('PZRX1:') || l.startsWith('PZRX2:'));
    return pzrLines.length > 0 ? pzrLines[pzrLines.length - 1] : null;
  } catch {
    return null;
  }
}

async function handleNewRankFile(filePath) {
  console.log('[sync] novo arquivo:', filePath);

  if (!config.playerToken) {
    notify('PZ Rank', 'Arquivo detectado — configure o jogador no app.');
    showMainWindow();
    return;
  }

  const code = extractCode(filePath);
  if (!code) { console.warn('[sync] código PZRX2 não encontrado'); return; }

  syncStatus = 'syncing';
  sendToRenderer('status-update', getStatusPayload());

  try {
    const result = await postSync(config.playerToken, code);

    lastSync   = { ts: Date.now(), characterName: result.character_name, score: result.score };
    syncStatus = 'ok';

    const body = result.character_name
      ? `${result.character_name}  •  ${result.score ?? 0} pts`
      : 'Rank atualizado!';
    notify('✓ Rank sincronizado!', body);
  } catch (err) {
    syncStatus = 'error';
    console.error('[sync] erro:', err.message);

    if (err.status === 401 || err.status === 403) {
      config.playerToken = '';
      saveConfig();
      showMainWindow();
      notify('✗ Sessão expirada', 'Reconecte o jogador no app.');
    } else {
      enqueue(code);
      notify('✗ Falha no sync', 'Salvo na fila — será reenviado automaticamente.');
    }
  }

  updateTray();
  sendToRenderer('status-update', getStatusPayload());
}

// ── Sandbox sync ─────────────────────────────────────────────────────────────

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

function postSync(playerToken, code) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ player_token: playerToken, code });
    const u    = new URL(config.apiUrl + '/sync/update');
    const lib  = u.protocol === 'https:' ? https : http;

    const req = lib.request(
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
  nick:      config.nick,
  watchDir:  config.watchDir,
  autostart: config.autostart,
}));

ipcMain.handle('lookup-player', async (_, nick) => {
  try {
    const url    = `${config.apiUrl}/sync/lookup?nick=${encodeURIComponent(nick)}`;
    const result = await getRequest(url);
    if (!result.player_token) throw new Error(result.error || 'Jogador não encontrado ou não aprovado');
    config.nick        = nick;
    config.playerToken = result.player_token;
    saveConfig();
    updateTray();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-settings', (_, { watchDir }) => {
  if (watchDir) config.watchDir = watchDir;
  saveConfig();
  startWatcher();
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
  config.nick        = '';
  config.playerToken = '';
  saveConfig();
  updateTray();
  sendToRenderer('status-update', getStatusPayload());
  return { success: true };
});

ipcMain.handle('open-external', (_, url) => shell.openExternal(url));

ipcMain.handle('open-site', () => shell.openExternal(config.apiUrl));

ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    sendToRenderer('update-status', { phase: 'up-to-date' });
    return;
  }
  try { await autoUpdater.checkForUpdates(); }
  catch (err) { sendToRenderer('update-status', { phase: 'error', message: err.message }); }
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
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
    connected:     !!config.playerToken,
    nick:          config.nick,
    syncStatus,
    lastSync,
    watchDir:      config.watchDir,
    watchDirExists: fs.existsSync(config.watchDir),
    watcherError,
    gameRunning,
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

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body }).show();
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
  exec('tasklist /FI "IMAGENAME eq ProjectZomboid64.exe" /NH /FO CSV 2>NUL', (err, stdout) => {
    const running = !err && stdout.toLowerCase().includes('projectzomboid64.exe');
    if (running !== gameRunning) {
      gameRunning = running;
      updateTray();
      sendToRenderer('status-update', getStatusPayload());
    }
  });
}