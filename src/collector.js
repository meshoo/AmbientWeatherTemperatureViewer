'use strict';

const cron = require('node-cron');
const { AmbientWeatherCollector } = require('./services/ambientWeather');
const q = require('./db/queries');

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = parseInt(process.env.DATA_RETENTION_DAYS || '365', 10);

// How far back to backfill on startup (90 days)
const BACKFILL_WINDOW_DAYS = 90;

let _collector = null;
let _lastPollAt = null;
let _lastPruneAt = null;

function start(db) {
    _collector = new AmbientWeatherCollector(db);

    // ── Real-time poll: every 5 minutes ──────────────────────────────────────
    cron.schedule('*/5 * * * *', async () => {
        await _collector.pollLatest();
        _lastPollAt = Date.now();
    });

    // ── Weekly prune: Sundays at 03:00 ───────────────────────────────────────
    cron.schedule('0 3 * * 0', () => {
        console.log('[collector] Running weekly data prune');
        const result = q.pruneOldReadings(db, RETENTION_DAYS);
        _lastPruneAt = Date.now();
        console.log(`[collector] Prune complete: ${result.deletedReadings} readings removed`);
    });

    // ── Startup: poll immediately, then kick off backfill ────────────────────
    setImmediate(async () => {
        await _collector.pollLatest();
        _lastPollAt = Date.now();

        const backfillStart = Date.now() - BACKFILL_WINDOW_DAYS * DAY_MS;
        const backfillEnd = Date.now();

        console.log(`[collector] Starting backfill for last ${BACKFILL_WINDOW_DAYS} days`);
        // Non-blocking: backfill runs in background
        _collector.backfill(backfillStart, backfillEnd).catch(err => {
            console.error('[collector] Background backfill error:', err.message);
        });
    });

    console.log('[collector] Started (poll every 5 min, prune weekly)');
}

/**
 * Trigger a manual backfill for a specific date range.
 * @param {string} startDate - 'YYYY-MM-DD'
 * @param {string} endDate - 'YYYY-MM-DD'
 */
async function triggerBackfill(startDate, endDate) {
    if (!_collector) throw new Error('Collector not started');

    const startMs = new Date(startDate + 'T00:00:00.000Z').getTime();
    const endMs = new Date(endDate + 'T23:59:59.999Z').getTime();

    // Run in background, don't await
    _collector.backfill(startMs, endMs).catch(err => {
        console.error('[collector] Manual backfill error:', err.message);
    });
}

function getStatus() {
    return {
        lastPollAt: _lastPollAt,
        lastPruneAt: _lastPruneAt,
        isBackfilling: _collector ? _collector.isBackfilling : false,
    };
}

module.exports = { start, triggerBackfill, getStatus };
