'use strict';

/**
 * All SQL query functions.
 * better-sqlite3 is synchronous — no async/await needed.
 */

// ─── Channels ────────────────────────────────────────────────────────────────

function getAllChannels(db) {
    return db.prepare(`
        SELECT key, source, name, enabled, color, sort_order
        FROM channels
        ORDER BY sort_order ASC, key ASC
    `).all();
}

function getEnabledChannels(db) {
    return db.prepare(`
        SELECT key, source, name, enabled, color, sort_order
        FROM channels
        WHERE enabled = 1
        ORDER BY sort_order ASC, key ASC
    `).all();
}

function updateChannel(db, key, { name, enabled, color }) {
    const fields = [];
    const values = [];

    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (enabled !== undefined) { fields.push('enabled = ?'); values.push(enabled ? 1 : 0); }
    if (color !== undefined) { fields.push('color = ?'); values.push(color); }

    if (fields.length === 0) return;
    values.push(key);

    db.prepare(`UPDATE channels SET ${fields.join(', ')} WHERE key = ?`).run(...values);
}

// ─── Readings ─────────────────────────────────────────────────────────────────

/**
 * Insert a batch of readings. Uses INSERT OR IGNORE to handle duplicates gracefully.
 * @param {Object[]} rows - Array of reading objects
 */
function insertReadingsBatch(db, rows) {
    if (!rows || rows.length === 0) return 0;

    const stmt = db.prepare(`
        INSERT OR IGNORE INTO readings
            (source, channel_key, recorded_at, temp_f, humidity, feels_like_f, dew_point_f, battery_ok, raw_value)
        VALUES
            (@source, @channel_key, @recorded_at, @temp_f, @humidity, @feels_like_f, @dew_point_f, @battery_ok, @raw_value)
    `);

    const insertMany = db.transaction((rows) => {
        let inserted = 0;
        for (const row of rows) {
            const info = stmt.run({
                source: row.source,
                channel_key: row.channel_key,
                recorded_at: row.recorded_at,
                temp_f: row.temp_f ?? null,
                humidity: row.humidity ?? null,
                feels_like_f: row.feels_like_f ?? null,
                dew_point_f: row.dew_point_f ?? null,
                battery_ok: row.battery_ok ?? null,
                raw_value: row.raw_value ?? null,
            });
            inserted += info.changes;
        }
        return inserted;
    });

    return insertMany(rows);
}

/**
 * Get the most recent reading for each enabled channel.
 */
function getLatestReadings(db) {
    return db.prepare(`
        SELECT r.channel_key, r.source, r.recorded_at, r.temp_f, r.humidity,
               r.feels_like_f, r.dew_point_f, r.battery_ok,
               c.name, c.color
        FROM readings r
        JOIN channels c ON c.key = r.channel_key
        WHERE c.enabled = 1
          AND r.recorded_at = (
              SELECT MAX(r2.recorded_at)
              FROM readings r2
              WHERE r2.channel_key = r.channel_key
          )
        ORDER BY c.sort_order ASC, r.channel_key ASC
    `).all();
}

/**
 * Get readings for a set of channels within a time range.
 * @param {string[]} channelKeys
 * @param {number} startMs - Unix ms
 * @param {number} endMs - Unix ms
 */
function getReadingsInRange(db, channelKeys, startMs, endMs) {
    if (!channelKeys || channelKeys.length === 0) return [];

    const placeholders = channelKeys.map(() => '?').join(', ');
    return db.prepare(`
        SELECT channel_key, recorded_at, temp_f, humidity
        FROM readings
        WHERE channel_key IN (${placeholders})
          AND recorded_at >= ?
          AND recorded_at <= ?
        ORDER BY recorded_at ASC
    `).all(...channelKeys, startMs, endMs);
}

/**
 * Get readings for a specific day (midnight to midnight local time expressed as ms).
 */
function getReadingsForDay(db, channelKeys, dayStartMs, dayEndMs) {
    return getReadingsInRange(db, channelKeys, dayStartMs, dayEndMs);
}

/**
 * Get the timestamp of the most recent reading for a source.
 */
function getLastRecordedAt(db, source) {
    const row = db.prepare(`
        SELECT MAX(recorded_at) as last_at FROM readings WHERE source = ?
    `).get(source);
    return row?.last_at ?? null;
}

/**
 * Get readings near a specific time-of-day across a date range (for /patterns).
 * Returns one reading per calendar day closest to the target minute-of-day.
 * @param {string[]} channelKeys
 * @param {number} startMs
 * @param {number} endMs
 * @param {number} targetMinuteOfDay - e.g. 8*60 for 8:00 AM
 * @param {number} windowMinutes - tolerance (default ±15 min)
 */
function getPatternReadings(db, channelKeys, startMs, endMs, targetMinuteOfDay, windowMinutes = 15) {
    if (!channelKeys || channelKeys.length === 0) return [];

    const placeholders = channelKeys.map(() => '?').join(', ');

    // We fetch all readings in the window and deduplicate to one-per-day in JS
    // SQLite doesn't easily express "minute of day" without a UDF
    const minOfDayMs = (targetMinuteOfDay - windowMinutes) * 60000;
    const maxOfDayMs = (targetMinuteOfDay + windowMinutes) * 60000;

    // recorded_at % 86400000 gives ms-since-midnight-UTC
    return db.prepare(`
        SELECT channel_key, recorded_at, temp_f
        FROM readings
        WHERE channel_key IN (${placeholders})
          AND recorded_at >= ?
          AND recorded_at <= ?
          AND (recorded_at % 86400000) >= ?
          AND (recorded_at % 86400000) <= ?
        ORDER BY recorded_at ASC
    `).all(...channelKeys, startMs, endMs, minOfDayMs, maxOfDayMs);
}

// ─── Collection Log ───────────────────────────────────────────────────────────

function recordCollectionWindow(db, source, periodStart, periodEnd, recordCount) {
    db.prepare(`
        INSERT INTO collection_log (source, period_start, period_end, record_count, collected_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(source, periodStart, periodEnd, recordCount, Date.now());
}

/**
 * Find uncovered time windows within [startMs, endMs] for the given source.
 * Returns an array of {start, end} gaps.
 */
function findMissingWindows(db, source, startMs, endMs) {
    const covered = db.prepare(`
        SELECT period_start, period_end
        FROM collection_log
        WHERE source = ?
          AND period_start >= ?
          AND period_end <= ?
        ORDER BY period_start ASC
    `).all(source, startMs, endMs);

    const gaps = [];
    let cursor = startMs;

    for (const w of covered) {
        if (cursor < w.period_start) {
            gaps.push({ start: cursor, end: w.period_start - 1 });
        }
        if (w.period_end > cursor) {
            cursor = w.period_end + 1;
        }
    }

    if (cursor < endMs) {
        gaps.push({ start: cursor, end: endMs });
    }

    return gaps;
}

// ─── Admin / Stats ────────────────────────────────────────────────────────────

function getDbStats(db) {
    const readingCount = db.prepare('SELECT COUNT(*) as cnt FROM readings').get().cnt;
    const oldestReading = db.prepare('SELECT MIN(recorded_at) as t FROM readings').get().t;
    const newestReading = db.prepare('SELECT MAX(recorded_at) as t FROM readings').get().t;
    const collectionCount = db.prepare('SELECT COUNT(*) as cnt FROM collection_log').get().cnt;
    return { readingCount, oldestReading, newestReading, collectionCount };
}

function pruneOldReadings(db, retentionDays) {
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const r1 = db.prepare('DELETE FROM readings WHERE recorded_at < ?').run(cutoffMs);
    const r2 = db.prepare('DELETE FROM collection_log WHERE period_end < ?').run(cutoffMs);
    db.prepare('VACUUM').run();
    return { deletedReadings: r1.changes, deletedLogEntries: r2.changes };
}

module.exports = {
    getAllChannels,
    getEnabledChannels,
    updateChannel,
    insertReadingsBatch,
    getLatestReadings,
    getReadingsInRange,
    getReadingsForDay,
    getPatternReadings,
    getLastRecordedAt,
    recordCollectionWindow,
    findMissingWindows,
    getDbStats,
    pruneOldReadings,
};
