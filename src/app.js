'use strict';

const express = require('express');
const path = require('path');

const apiRouter = require('./routes/api');
const viewRouter = require('./routes/views');

function createApp(db) {
    const app = express();

    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, '../views'));
    app.use(express.static(path.join(__dirname, '../public')));

    // Make db available to all routes via app.locals
    app.locals.db = db;

    app.use('/api', apiRouter);
    app.use('/', viewRouter);

    // Simple error handler
    app.use((err, req, res, _next) => {
        console.error('[app] Unhandled error:', err.message);
        res.status(500).send(`Internal error: ${err.message}`);
    });

    return app;
}

module.exports = { createApp };
