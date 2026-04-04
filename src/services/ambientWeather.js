'use strict';

const AmbientWeatherApi = require('ambient-weather-api');
const q = require('../db/queries');

// AW returns up to 288 records per call (5-min intervals = exactly 24 hours)
const MAX_RECORDS_PER_CALL = 288;
const DAY_MS = 24 * 60 * 60 * 1000;

// Conservative rate limit: 1500ms minimum between API calls
const MIN_CALL_INTERVAL_MS = 1500;

class AmbientWeatherCollector {
    constructor(db) {
        this._db = db;
        this._api = null;
        this._mock = null;
        this._lastCallAt = 0;
        this._backfilling = false;

        if (process.env.USE_MOCK_DATA === 'true') {
            const MockApi = require('./mockData');
            this._mock = new MockApi();
            console.log('[aw] Using mock data');
        } else {
            this._api = new AmbientWeatherApi({
                apiKey: process.env.AW_API_KEY,
                applicationKey: process.env.AW_APP_KEY,
            });
        }

        this._mac = process.env.AW_DEVICE_MAC;
        if (!this._mac && !this._mock) {
            throw new Error('AW_DEVICE_MAC environment variable is required');
        }
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    /**
     * Fetch the single most recent reading and store it.
     * Called by the real-time cron every 5 minutes.
     */
    async pollLatest() {
        try {
            const data = await this._throttledFetch({ limit: 1 });
            if (!data || data.length === 0) return;

            const rows = this._normalizeReadings(data);
            const inserted = q.insertReadingsBatch(this._db, rows);
            console.log(`[aw] poll: inserted ${inserted} new readings`);
        } catch (err) {
            console.error('[aw] poll error:', err.message);
        }
    }

    /**
     * Fill any missing windows between startMs and endMs.
     * Called once on startup and can be triggered manually via /api/admin/backfill.
     * Non-blocking — caller does not await.
     */
    async backfill(startMs, endMs) {
        if (this._backfilling) {
            console.log('[aw] backfill already running, skipping');
            return;
        }
        this._backfilling = true;

        try {
            const gaps = q.findMissingWindows(this._db, 'ambient', startMs, endMs);
            if (gaps.length === 0) {
                console.log('[aw] backfill: no gaps found');
                return;
            }

            console.log(`[aw] backfill: found ${gaps.length} gap(s) to fill`);

            for (const gap of gaps) {
                await this._fillGap(gap.start, gap.end);
            }

            console.log('[aw] backfill: complete');
        } catch (err) {
            console.error('[aw] backfill error:', err.message);
        } finally {
            this._backfilling = false;
        }
    }

    get isBackfilling() {
        return this._backfilling;
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    async _fillGap(gapStart, gapEnd) {
        let cursor = gapStart;

        while (cursor <= gapEnd) {
            const chunkEnd = Math.min(gapEnd, cursor + DAY_MS - 1);

            try {
                const data = await this._throttledFetch({
                    startDate: cursor,
                    endDate: chunkEnd,
                    limit: MAX_RECORDS_PER_CALL,
                });

                if (data && data.length > 0) {
                    const rows = this._normalizeReadings(data);
                    const inserted = q.insertReadingsBatch(this._db, rows);
                    q.recordCollectionWindow(this._db, 'ambient', cursor, chunkEnd, data.length);
                    console.log(`[aw] backfill chunk ${new Date(cursor).toLocaleDateString()}: ${data.length} records, ${inserted} new`);
                } else {
                    // Record the window even if empty so we don't re-fetch it
                    q.recordCollectionWindow(this._db, 'ambient', cursor, chunkEnd, 0);
                }
            } catch (err) {
                console.error(`[aw] chunk fetch error (${new Date(cursor).toLocaleDateString()}):`, err.message);
                // Don't record the window — we'll retry next backfill run
            }

            cursor = chunkEnd + 1;
        }
    }

    async _throttledFetch(params) {
        const now = Date.now();
        const elapsed = now - this._lastCallAt;
        if (elapsed < MIN_CALL_INTERVAL_MS) {
            await sleep(MIN_CALL_INTERVAL_MS - elapsed);
        }
        this._lastCallAt = Date.now();

        const client = this._mock || this._api;
        return client.deviceData(this._mac, params);
    }

    /**
     * Convert AW API reading objects into flat rows for the readings table.
     * Each sensor channel becomes a separate row.
     */
    _normalizeReadings(apiData) {
        const rows = [];

        for (const reading of apiData) {
            const recordedAt = new Date(reading.date).getTime();
            if (isNaN(recordedAt)) continue;

            for (let i = 1; i <= 8; i++) {
                const tempKey = `temp${i}f`;
                const tempVal = reading[tempKey];
                if (tempVal === undefined || tempVal === null) continue;

                rows.push({
                    source: 'ambient',
                    channel_key: tempKey,
                    recorded_at: recordedAt,
                    temp_f: typeof tempVal === 'number' ? tempVal : null,
                    humidity: reading[`humidity${i}`] ?? null,
                    feels_like_f: reading[`feelsLike${i}`] ?? null,
                    dew_point_f: reading[`dewPoint${i}`] ?? null,
                    battery_ok: reading[`batt${i}`] !== undefined
                        ? (reading[`batt${i}`] ? 1 : 0)
                        : null,
                });
            }
        }

        return rows;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { AmbientWeatherCollector };
