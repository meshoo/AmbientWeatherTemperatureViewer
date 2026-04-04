'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const { applySchema, seedDefaultChannels } = require('./schema');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/claudeawgraphs.db');

let _db = null;

function getDb() {
    if (_db) return _db;

    _db = new Database(DB_PATH);
    applySchema(_db);
    seedDefaultChannels(_db);
    console.log(`[db] Connected: ${DB_PATH}`);

    return _db;
}

module.exports = { getDb };
