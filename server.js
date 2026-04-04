'use strict';

require('dotenv').config();

const { getDb } = require('./src/db/index');
const { createApp } = require('./src/app');
const collector = require('./src/collector');

const PORT = parseInt(process.env.PORT || '3000', 10);

// Initialize database
const db = getDb();

// Create Express app
const app = createApp(db);

// Start listening
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] ClaudeAWGraphs running on port ${PORT}`);

    // Start background data collection
    collector.start(db);
});
