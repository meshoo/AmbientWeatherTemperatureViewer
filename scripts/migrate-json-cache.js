#!/usr/bin/env node
'use strict';

/**
 * One-time migration: imports CursorAWGraphs temperature_cache.json → ClaudeAWGraphs SQLite.
 *
 * Usage:
 *   node scripts/migrate-json-cache.js \
 *     --input "C:/Users/micha/OneDrive/Documents-mike-pc2201/Development/CursorAWGraphs/data/temperature_cache.json" \
 *     --db ./data/claudeawgraphs.db
 *
 * The script is idempotent — safe to run multiple times (uses INSERT OR IGNORE).
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// ── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
    const idx = args.indexOf(name);
    return idx !== -1 ? args[idx + 1] : null;
}

const inputPath = getArg('--input') ||
    'C:/Users/micha/OneDrive/Documents-mike-pc2201/Development/CursorAWGraphs/data/temperature_cache.json';
const dbPath = getArg('--db') || path.join(__dirname, '../data/claudeawgraphs.db');

console.log('Input JSON:', inputPath);
console.log('Target DB: ', dbPath);

// ── Load and validate input ──────────────────────────────────────────────────
if (!fs.existsSync(inputPath)) {
    console.error('ERROR: Input file not found:', inputPath);
    process.exit(1);
}

const raw = fs.readFileSync(inputPath, 'utf8');
let cache;
try {
    cache = JSON.parse(raw);
} catch (e) {
    console.error('ERROR: Invalid JSON in input file:', e.message);
    process.exit(1);
}

// CursorAWGraphs cache structure: { readings: { "YYYY-MM-DD": [...] } }
const dailyBuckets = cache.readings || cache;
const days = Object.keys(dailyBuckets).sort();
console.log(`Found ${days.length} days of cached data`);

// ── Open DB and apply schema ─────────────────────────────────────────────────
const { applySchema, seedDefaultChannels } = require('../src/db/schema');
const q = require('../src/db/queries');

const db = new Database(dbPath);
applySchema(db);
seedDefaultChannels(db);

// ── Migration ────────────────────────────────────────────────────────────────
const stmt = db.prepare(`
    INSERT OR IGNORE INTO readings
        (source, channel_key, recorded_at, temp_f, humidity, feels_like_f, dew_point_f, battery_ok)
    VALUES
        (@source, @channel_key, @recorded_at, @temp_f, @humidity, @feels_like_f, @dew_point_f, @battery_ok)
`);

const logStmt = db.prepare(`
    INSERT OR IGNORE INTO collection_log (source, period_start, period_end, record_count, collected_at)
    VALUES (?, ?, ?, ?, ?)
`);

let totalRows = 0;
let totalInserted = 0;
let daysMigrated = 0;

const migrateDay = db.transaction((dayKey, readings) => {
    let dayInserted = 0;

    for (const reading of readings) {
        const recordedAt = new Date(reading.date).getTime();
        if (isNaN(recordedAt)) continue;

        for (let i = 1; i <= 8; i++) {
            const tempKey = `temp${i}f`;
            const tempVal = reading[tempKey];
            if (tempVal === undefined || tempVal === null) continue;

            const info = stmt.run({
                source: 'ambient',
                channel_key: tempKey,
                recorded_at: recordedAt,
                temp_f: typeof tempVal === 'number' ? tempVal : null,
                humidity: reading[`humidity${i}`] ?? null,
                feels_like_f: reading[`feelsLike${i}`] ?? null,
                dew_point_f: reading[`dewPoint${i}`] ?? null,
                battery_ok: reading[`batt${i}`] !== undefined ? (reading[`batt${i}`] ? 1 : 0) : null,
            });
            dayInserted += info.changes;
        }

        totalRows++;
    }

    if (readings.length > 0) {
        const timestamps = readings
            .map(r => new Date(r.date).getTime())
            .filter(t => !isNaN(t));
        if (timestamps.length > 0) {
            const periodStart = Math.min(...timestamps);
            const periodEnd = Math.max(...timestamps);
            logStmt.run('ambient', periodStart, periodEnd, readings.length, Date.now());
        }
    }

    return dayInserted;
});

for (const day of days) {
    const readings = dailyBuckets[day];
    if (!Array.isArray(readings) || readings.length === 0) continue;

    try {
        const inserted = migrateDay(day, readings);
        totalInserted += inserted;
        daysMigrated++;

        if (daysMigrated % 10 === 0) {
            process.stdout.write(`\r  Migrated ${daysMigrated}/${days.length} days, ${totalInserted} rows inserted...`);
        }
    } catch (err) {
        console.error(`\nError migrating day ${day}:`, err.message);
    }
}

console.log(`\n\nMigration complete:`);
console.log(`  Days processed:  ${daysMigrated}`);
console.log(`  Readings parsed: ${totalRows}`);
console.log(`  Rows inserted:   ${totalInserted} (rest were duplicates or already present)`);

// ── Verify ───────────────────────────────────────────────────────────────────
const stats = q.getDbStats(db);
console.log(`\nDB stats after migration:`);
console.log(`  Total readings: ${stats.readingCount.toLocaleString()}`);
console.log(`  Oldest:         ${stats.oldestReading ? new Date(stats.oldestReading).toLocaleDateString() : 'none'}`);
console.log(`  Newest:         ${stats.newestReading ? new Date(stats.newestReading).toLocaleDateString() : 'none'}`);
console.log(`  Collection log: ${stats.collectionCount} entries`);

db.close();
