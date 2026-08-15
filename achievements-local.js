'use strict';

const db = require('./db');

function buildStatsMap(stats, kills, skillLevels) {
  const s = stats || {};
  const spiffo = s.spiffo_visited || 0;

  const map = {
    kills:               kills || 0,
    animals_killed:      s.animals_killed      || 0,
    fish_caught:         s.fish_caught         || 0,
    crops_harvested:     s.crops_harvested     || 0,
    items_crafted:       s.items_crafted       || 0,
    houses_looted:       s.houses_looted       || 0,
    hours_without_sleep: s.hours_without_sleep || 0,
    trees_cut:           s.trees_cut           || 0,
    books_read:          s.books_read          || 0,
    structures_built:    s.structures_built    || 0,
    crops_planted:       s.crops_planted       || 0,
    spiffo_visited:      spiffo,
    spiffo_base_any:     spiffo,
    spiffo_base_five:    spiffo,
    all_spiffo_bases:    spiffo >= 13 ? 1 : 0,
    eggs_collected:      s.eggs_collected      || 0,
    milk_produced:       s.milk_produced       || 0,
    stone_structures:    s.stone_structures    || 0,
    ceramic_items:       s.ceramic_items       || 0,
    forged_weapons:      s.forged_weapons      || 0,
    km_driven:           s.km_driven           || 0,
    cities_visited:      s.cities_visited      || 0,
    military_visited:    s.military_visited    || 0,
    meals_cooked:        s.meals_cooked        || 0,
    water_collected:     s.water_collected     || 0,
    materials_crafted:   s.materials_crafted   || 0,
    animal_tracks:       s.animal_tracks       || 0,
    weapons_crafted:     s.weapons_crafted     || 0,
    furniture_crafted:   s.furniture_crafted   || 0,
    clothes_crafted:     s.clothes_crafted     || 0,
    cheese_produced:     s.cheese_produced     || 0,
    doors_opened:        s.doors_opened        || 0,
    sleep_locations:     s.sleep_locations     || 0,
    basements_explored:  s.basements_explored  || 0,
    all_stations_used:   s.stations_used       || 0,
    animal_species:      s.animal_species      || 0,
    days_no_canned:      s.days_no_canned      || 0,
  };

  if (skillLevels && typeof skillLevels === 'object') {
    for (const [id, level] of Object.entries(skillLevels)) {
      map[`skill_${id}`] = level;
    }
  }

  return map;
}

function evaluate(charName, stats, kills, skillLevels) {
  const catalog = db.getCatalog();
  if (catalog.length === 0) return [];

  const unlocked  = db.getUnlockedSlugs(charName);
  const statsMap  = buildStatsMap(stats, kills, skillLevels);
  const newUnlocks = [];

  for (const ach of catalog) {
    if (unlocked.has(ach.slug)) continue;
    const val = statsMap[ach.stat] ?? 0;
    if (val >= ach.threshold) {
      const isNew = db.upsertAchievement(charName, ach.slug, ach.name, ach.tier);
      if (isNew) newUnlocks.push({ slug: ach.slug, name: ach.name, tier: ach.tier, icon: ach.icon });
    }
  }

  return newUnlocks;
}

module.exports = { evaluate };
