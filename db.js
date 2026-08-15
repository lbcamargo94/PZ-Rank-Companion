'use strict';

const path = require('path');

let _db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS characters (
  char_name     TEXT PRIMARY KEY,
  status        TEXT DEFAULT 'unknown',
  kills         INTEGER DEFAULT 0,
  score         INTEGER DEFAULT 0,
  rank_position INTEGER,
  first_seen    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stats_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  char_name     TEXT NOT NULL,
  ts            INTEGER NOT NULL,
  kills         INTEGER,
  score         INTEGER,
  rank_position INTEGER,
  stats_json    TEXT
);

CREATE TABLE IF NOT EXISTS achievements_log (
  char_name        TEXT NOT NULL,
  achievement_slug TEXT NOT NULL,
  achievement_name TEXT,
  achievement_tier TEXT,
  unlocked_at      INTEGER NOT NULL,
  PRIMARY KEY (char_name, achievement_slug)
);

CREATE TABLE IF NOT EXISTS achievements_catalog (
  id        INTEGER,
  slug      TEXT PRIMARY KEY,
  name      TEXT,
  description TEXT,
  icon      TEXT,
  tier      TEXT,
  stat      TEXT,
  threshold REAL,
  cached_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE INDEX IF NOT EXISTS idx_stats_history_char ON stats_history(char_name, ts DESC);
CREATE INDEX IF NOT EXISTS idx_achievements_log_char ON achievements_log(char_name);
`;

const MIGRATIONS = [
  // v1 — baseline (handled by SCHEMA above)
];

function init(userDataPath) {
  if (_db) return _db;

  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (e) {
    console.error('[db] better-sqlite3 não disponível:', e.message);
    return null;
  }

  const dbPath = path.join(userDataPath, 'companion.db');

  try {
    _db = new Database(dbPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.exec(SCHEMA);
    runMigrations();
    console.log('[db] banco local inicializado:', dbPath);
  } catch (e) {
    console.error('[db] falha ao inicializar banco:', e.message);
    _db = null;
  }

  return _db;
}

function runMigrations() {
  if (!_db) return;
  let currentVersion = 0;
  try {
    const row = _db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get();
    if (row) currentVersion = row.version;
  } catch { /* tabela pode não existir ainda — está no SCHEMA */ }

  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    _db.exec(MIGRATIONS[i]);
    _db.prepare('INSERT OR REPLACE INTO schema_version(version) VALUES(?)').run(i + 1);
    console.log(`[db] migration ${i + 1} aplicada`);
  }
}

function upsertCharacter(charName, { status, kills, score, rankPosition } = {}) {
  if (!_db || !charName) return;
  const now = Date.now();
  try {
    const existing = _db.prepare('SELECT first_seen FROM characters WHERE char_name = ?').get(charName);
    if (existing) {
      _db.prepare(`UPDATE characters SET
        status        = COALESCE(?, status),
        kills         = COALESCE(?, kills),
        score         = COALESCE(?, score),
        rank_position = ?,
        last_seen     = ?
        WHERE char_name = ?`).run(status ?? null, kills ?? null, score ?? null, rankPosition ?? null, now, charName);
    } else {
      _db.prepare(`INSERT INTO characters(char_name, status, kills, score, rank_position, first_seen, last_seen)
        VALUES(?, ?, ?, ?, ?, ?, ?)`).run(charName, status ?? 'unknown', kills ?? 0, score ?? 0, rankPosition ?? null, now, now);
    }
  } catch (e) {
    console.error('[db] upsertCharacter:', e.message);
  }
}

function appendStatsHistory(charName, { ts, kills, score, rankPosition, statsJson } = {}) {
  if (!_db || !charName) return;
  try {
    _db.prepare(`INSERT INTO stats_history(char_name, ts, kills, score, rank_position, stats_json)
      VALUES(?, ?, ?, ?, ?, ?)`).run(charName, ts ?? Date.now(), kills ?? null, score ?? null, rankPosition ?? null, statsJson ?? null);
  } catch (e) {
    console.error('[db] appendStatsHistory:', e.message);
  }
}

function updateStatsJson(charName, statsJson) {
  if (!_db || !charName) return;
  try {
    _db.prepare(`UPDATE stats_history SET stats_json = ?
      WHERE id = (SELECT id FROM stats_history WHERE char_name = ? ORDER BY ts DESC LIMIT 1)`)
      .run(statsJson, charName);
  } catch (e) {
    console.error('[db] updateStatsJson:', e.message);
  }
}

function importLegacyHistory(historyArray) {
  if (!_db || !Array.isArray(historyArray) || historyArray.length === 0) return 0;
  let count = 0;
  const insert = _db.prepare(`INSERT OR IGNORE INTO stats_history(char_name, ts, score, rank_position)
    VALUES(?, ?, ?, ?)`);
  const tx = _db.transaction(() => {
    for (const h of historyArray) {
      if (!h.ok || !h.characterName) continue;
      insert.run(h.characterName, h.ts ?? Date.now(), h.score ?? null, h.rankPosition ?? null);
      upsertCharacter(h.characterName, { score: h.score });
      count++;
    }
  });
  try { tx(); } catch (e) { console.error('[db] importLegacyHistory:', e.message); }
  return count;
}

function upsertAchievement(charName, slug, name, tier) {
  if (!_db || !charName || !slug) return false;
  try {
    const existing = _db.prepare('SELECT 1 FROM achievements_log WHERE char_name = ? AND achievement_slug = ?').get(charName, slug);
    if (existing) return false;
    _db.prepare(`INSERT OR IGNORE INTO achievements_log(char_name, achievement_slug, achievement_name, achievement_tier, unlocked_at)
      VALUES(?, ?, ?, ?, ?)`).run(charName, slug, name ?? null, tier ?? null, Date.now());
    return true;
  } catch (e) {
    console.error('[db] upsertAchievement:', e.message);
    return false;
  }
}

function upsertCatalog(achievements) {
  if (!_db || !Array.isArray(achievements)) return;
  const now = Date.now();
  const insert = _db.prepare(`INSERT OR REPLACE INTO achievements_catalog(id, slug, name, description, icon, tier, stat, threshold, cached_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const tx = _db.transaction(() => {
    for (const a of achievements) {
      insert.run(a.id, a.slug, a.name, a.description ?? null, a.icon ?? null, a.tier ?? null, a.stat, a.threshold, now);
    }
  });
  try { tx(); } catch (e) { console.error('[db] upsertCatalog:', e.message); }
}

function getCatalog() {
  if (!_db) return [];
  try {
    return _db.prepare('SELECT * FROM achievements_catalog ORDER BY stat, threshold').all();
  } catch { return []; }
}

function getCatalogAge() {
  if (!_db) return Infinity;
  try {
    const row = _db.prepare('SELECT MAX(cached_at) as ts FROM achievements_catalog').get();
    return row && row.ts ? Date.now() - row.ts : Infinity;
  } catch { return Infinity; }
}

function getCharacters() {
  if (!_db) return [];
  try {
    return _db.prepare('SELECT * FROM characters ORDER BY last_seen DESC').all();
  } catch { return []; }
}

function getCharacterDetail(charName) {
  if (!_db || !charName) return null;
  try {
    const character   = _db.prepare('SELECT * FROM characters WHERE char_name = ?').get(charName);
    const history     = _db.prepare('SELECT id, ts, kills, score, rank_position, stats_json FROM stats_history WHERE char_name = ? ORDER BY ts DESC LIMIT 50').all(charName);
    const achievements = _db.prepare('SELECT * FROM achievements_log WHERE char_name = ? ORDER BY unlocked_at DESC').all(charName);
    return { character: character ?? null, history, achievements };
  } catch (e) {
    console.error('[db] getCharacterDetail:', e.message);
    return null;
  }
}

function getUnlockedSlugs(charName) {
  if (!_db || !charName) return new Set();
  try {
    const rows = _db.prepare('SELECT achievement_slug FROM achievements_log WHERE char_name = ?').all(charName);
    return new Set(rows.map(r => r.achievement_slug));
  } catch { return new Set(); }
}

module.exports = {
  init,
  upsertCharacter,
  appendStatsHistory,
  updateStatsJson,
  importLegacyHistory,
  upsertAchievement,
  upsertCatalog,
  getCatalog,
  getCatalogAge,
  getCharacters,
  getCharacterDetail,
  getUnlockedSlugs,
};
