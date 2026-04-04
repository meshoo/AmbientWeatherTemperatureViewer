'use strict';

// Default channel colors — matches CursorAWGraphs color order
const CHANNEL_COLORS = [
    '#3b82f6', // 1 blue
    '#ef4444', // 2 red
    '#eab308', // 3 yellow
    '#22c55e', // 4 green
    '#8b5cf6', // 5 purple
    '#f97316', // 6 orange
    '#06b6d4', // 7 cyan
    '#ec4899', // 8 pink
];

// Channels that are enabled by default for Michael's hardware
// temp1f = Outside, temp5f = Guest Bedroom, temp6f = Master Bedroom
const DEFAULT_ENABLED = new Set(['temp1f', 'temp5f', 'temp6f']);

function applySchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS readings (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            source       TEXT    NOT NULL,
            channel_key  TEXT    NOT NULL,
            recorded_at  INTEGER NOT NULL,
            temp_f       REAL,
            humidity     REAL,
            feels_like_f REAL,
            dew_point_f  REAL,
            battery_ok   INTEGER,
            raw_value    REAL,
            UNIQUE(source, channel_key, recorded_at)
        );

        CREATE INDEX IF NOT EXISTS idx_readings_channel_time
            ON readings(channel_key, recorded_at);

        CREATE INDEX IF NOT EXISTS idx_readings_source_time
            ON readings(source, recorded_at);

        CREATE TABLE IF NOT EXISTS channels (
            key        TEXT PRIMARY KEY,
            source     TEXT    NOT NULL,
            name       TEXT    NOT NULL,
            enabled    INTEGER NOT NULL DEFAULT 1,
            color      TEXT    NOT NULL DEFAULT '#3b82f6',
            sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS collection_log (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            source       TEXT    NOT NULL,
            period_start INTEGER NOT NULL,
            period_end   INTEGER NOT NULL,
            record_count INTEGER NOT NULL,
            collected_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_collection_log
            ON collection_log(source, period_start, period_end);
    `);

    // Enable WAL mode for safe concurrent reads during writes
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
}

function seedDefaultChannels(db) {
    const existing = db.prepare('SELECT COUNT(*) as cnt FROM channels').get();
    if (existing.cnt > 0) return; // already seeded

    const insert = db.prepare(`
        INSERT OR IGNORE INTO channels (key, source, name, enabled, color, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    const seedMany = db.transaction(() => {
        for (let i = 1; i <= 8; i++) {
            const key = `temp${i}f`;
            const enabled = DEFAULT_ENABLED.has(key) ? 1 : 0;
            const color = CHANNEL_COLORS[i - 1];
            const name = defaultChannelName(i);
            insert.run(key, 'ambient', name, enabled, color, i);
        }
    });

    seedMany();
    console.log('[db] Default channel config seeded');
}

function defaultChannelName(sensorIndex) {
    const names = {
        1: 'Outside',
        2: 'Channel 2',
        3: 'Channel 3',
        4: 'Channel 4',
        5: 'Guest Bedroom',
        6: 'Master Bedroom',
        7: 'Channel 7',
        8: 'Channel 8',
    };
    return names[sensorIndex] || `Channel ${sensorIndex}`;
}

module.exports = { applySchema, seedDefaultChannels };
