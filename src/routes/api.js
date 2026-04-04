'use strict';

const express = require('express');
const router = express.Router();
const q = require('../db/queries');
const collector = require('../collector');

// Middleware to attach db from app locals
router.use((req, res, next) => {
    req.db = req.app.locals.db;
    next();
});

// ─── Channels ─────────────────────────────────────────────────────────────────

// GET /api/channels — list all channels with config
router.get('/channels', (req, res) => {
    const channels = q.getAllChannels(req.db);
    res.json(channels);
});

// POST /api/channels/:key — update channel name, enabled, or color
router.post('/channels/:key', express.json(), (req, res) => {
    const { name, enabled, color } = req.body;
    try {
        q.updateChannel(req.db, req.params.key, { name, enabled, color });
        const channels = q.getAllChannels(req.db);
        const updated = channels.find(c => c.key === req.params.key);
        res.json(updated || { ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Current readings ─────────────────────────────────────────────────────────

// GET /api/current — latest reading per enabled channel
router.get('/current', (req, res) => {
    const readings = q.getLatestReadings(req.db);
    res.json(readings);
});

// ─── Time-range readings ──────────────────────────────────────────────────────

// GET /api/readings?channels=temp1f,temp5f&start=MS&end=MS
router.get('/readings', (req, res) => {
    const channels = req.query.channels
        ? req.query.channels.split(',').map(s => s.trim()).filter(Boolean)
        : q.getEnabledChannels(req.db).map(c => c.key);

    const endMs = parseInt(req.query.end, 10) || Date.now();
    const startMs = parseInt(req.query.start, 10) || endMs - 24 * 60 * 60 * 1000;

    const readings = q.getReadingsInRange(req.db, channels, startMs, endMs);
    res.json(readings);
});

// ─── Day-over-day compare ─────────────────────────────────────────────────────

// GET /api/compare?channels=temp1f,temp5f&dayA=YYYY-MM-DD&dayB=YYYY-MM-DD
router.get('/compare', (req, res) => {
    const channels = req.query.channels
        ? req.query.channels.split(',').map(s => s.trim()).filter(Boolean)
        : q.getEnabledChannels(req.db).map(c => c.key);

    const dayA = req.query.dayA;
    const dayB = req.query.dayB;

    if (!dayA || !dayB) {
        return res.status(400).json({ error: 'dayA and dayB query params required (YYYY-MM-DD)' });
    }

    const toRange = (dateStr) => {
        const start = new Date(dateStr + 'T00:00:00.000Z').getTime();
        const end = new Date(dateStr + 'T23:59:59.999Z').getTime();
        return { start, end };
    };

    const rangeA = toRange(dayA);
    const rangeB = toRange(dayB);

    const readingsA = q.getReadingsForDay(req.db, channels, rangeA.start, rangeA.end);
    const readingsB = q.getReadingsForDay(req.db, channels, rangeB.start, rangeB.end);

    // Normalize timestamps to seconds-since-midnight for overlay plotting
    const normalize = (readings, dayStartMs) =>
        readings.map(r => ({
            ...r,
            seconds_into_day: Math.floor((r.recorded_at - dayStartMs) / 1000),
        }));

    res.json({
        dayA: { date: dayA, readings: normalize(readingsA, rangeA.start) },
        dayB: { date: dayB, readings: normalize(readingsB, rangeB.start) },
        channels: q.getAllChannels(req.db).filter(c => channels.includes(c.key)),
    });
});

// ─── Patterns ─────────────────────────────────────────────────────────────────

// GET /api/patterns?channels=...&months=1&time=Breakfast
const DEFAULT_TIMES = [
    { name: 'Breakfast', hour: 8, minute: 0 },
    { name: 'Lunch', hour: 12, minute: 0 },
    { name: 'Dinner', hour: 18, minute: 0 },
    { name: 'Bedtime', hour: 21, minute: 0 },
];

router.get('/patterns', (req, res) => {
    const channels = req.query.channels
        ? req.query.channels.split(',').map(s => s.trim()).filter(Boolean)
        : q.getEnabledChannels(req.db).map(c => c.key);

    const months = Math.max(1, Math.min(6, parseInt(req.query.months, 10) || 1));
    const timeName = req.query.time || 'Breakfast';
    const timeConfig = DEFAULT_TIMES.find(t => t.name === timeName) || DEFAULT_TIMES[0];

    const endMs = Date.now();
    const startMs = endMs - months * 30 * 24 * 60 * 60 * 1000;
    const targetMinuteOfDay = timeConfig.hour * 60 + timeConfig.minute;

    const rows = q.getPatternReadings(req.db, channels, startMs, endMs, targetMinuteOfDay);

    // Deduplicate to one reading per channel per calendar day (UTC)
    const byChannelByDay = {};
    for (const row of rows) {
        const day = new Date(row.recorded_at).toISOString().slice(0, 10);
        const key = `${row.channel_key}|${day}`;
        if (!byChannelByDay[key]) {
            byChannelByDay[key] = row;
        }
    }

    res.json({
        data: Object.values(byChannelByDay),
        channels: q.getAllChannels(req.db).filter(c => channels.includes(c.key)),
        times: DEFAULT_TIMES,
        selectedTime: timeName,
        months,
    });
});

// ─── Daikin ingest (stub — enable when push agent is ready) ───────────────────

router.post('/ingest/daikin', express.json(), (req, res) => {
    if (!process.env.INGEST_TOKEN) {
        return res.status(404).json({ error: 'Daikin integration not enabled' });
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token !== process.env.INGEST_TOKEN) {
        return res.status(401).json({ error: 'unauthorized' });
    }

    const { recorded_at, temp_indoor_f, temp_outdoor_f, setpoint_cool_f, setpoint_heat_f } = req.body;
    if (!recorded_at) {
        return res.status(400).json({ error: 'recorded_at required' });
    }

    const rows = [
        temp_indoor_f != null && { source: 'daikin', channel_key: 'daikin_indoor', recorded_at, temp_f: temp_indoor_f },
        temp_outdoor_f != null && { source: 'daikin', channel_key: 'daikin_outdoor', recorded_at, temp_f: temp_outdoor_f },
        setpoint_cool_f != null && { source: 'daikin', channel_key: 'daikin_setpoint_cool', recorded_at, raw_value: setpoint_cool_f },
        setpoint_heat_f != null && { source: 'daikin', channel_key: 'daikin_setpoint_heat', recorded_at, raw_value: setpoint_heat_f },
    ].filter(Boolean);

    const inserted = q.insertReadingsBatch(req.db, rows);
    res.json({ ok: true, inserted });
});

// ─── Admin ────────────────────────────────────────────────────────────────────

// GET /api/admin/status
router.get('/admin/status', (req, res) => {
    const collectorStatus = collector.getStatus();
    const dbStats = q.getDbStats(req.db);
    res.json({
        ok: true,
        collector: collectorStatus,
        db: dbStats,
        uptime: process.uptime(),
    });
});

// POST /api/admin/backfill — body: {start: "YYYY-MM-DD", end: "YYYY-MM-DD"}
router.post('/admin/backfill', express.json(), async (req, res) => {
    const { start, end } = req.body;
    if (!start || !end) {
        return res.status(400).json({ error: 'start and end (YYYY-MM-DD) required' });
    }

    try {
        collector.triggerBackfill(start, end);
        res.json({ ok: true, message: `Backfill started for ${start} to ${end}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
module.exports.DEFAULT_TIMES = DEFAULT_TIMES;
