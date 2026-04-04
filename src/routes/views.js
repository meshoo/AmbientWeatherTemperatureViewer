'use strict';

const express = require('express');
const router = express.Router();
const q = require('../db/queries');
const { DEFAULT_TIMES } = require('./api');

router.use((req, res, next) => {
    req.db = req.app.locals.db;
    next();
});

// GET / — Current temperatures dashboard
router.get('/', (req, res) => {
    const channels = q.getEnabledChannels(req.db);
    res.render('current', { channels, currentPage: 'current' });
});

// GET /history
router.get('/history', (req, res) => {
    const selectedRange = req.query.range || '24h';
    const channels = q.getEnabledChannels(req.db);
    res.render('history', { selectedRange, channels, currentPage: 'history' });
});

// GET /compare
router.get('/compare', (req, res) => {
    const channels = q.getEnabledChannels(req.db);

    // Default dayA = yesterday, dayB = today
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const dayA = req.query.dayA || yesterday;
    const dayB = req.query.dayB || today;

    res.render('compare', { channels, dayA, dayB, currentPage: 'compare' });
});

// GET /patterns
router.get('/patterns', (req, res) => {
    const months = Math.max(1, Math.min(6, parseInt(req.query.months, 10) || 1));
    const selectedTime = req.query.time || 'Breakfast';
    const channels = q.getEnabledChannels(req.db);
    res.render('patterns', {
        channels,
        months,
        selectedTime,
        times: DEFAULT_TIMES,
        currentPage: 'patterns',
    });
});

// GET /admin
router.get('/admin', (req, res) => {
    const channels = q.getAllChannels(req.db);
    res.render('admin', { channels, currentPage: 'admin' });
});

module.exports = router;
