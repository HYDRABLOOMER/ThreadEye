/**
 * Run this script to print current FileLock documents and indexes.
 * Usage:
 *   node ./scripts/inspectLocks.js
 * It reads MONGO_URI from env or uses default mongodb://127.0.0.1:27017/loginDB
 */
const mongoose = require('mongoose');
require('dotenv').config();
const { FileLock } = require('../model/log');

const MONGO = process.env.MONGO_URI || process.env.MONGO || 'mongodb://127.0.0.1:27017/loginDB';

async function run() {
  await mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to', MONGO);

  const locks = await FileLock.find().lean();
  console.log('\n--- FileLock documents ---');
  if (locks.length === 0) {
    console.log('No locks found');
  } else {
    locks.forEach(l => {
      console.log(JSON.stringify(l, null, 2));
    });
  }

  // Print indexes on collection
  const col = mongoose.connection.db.collection('filelocks');
  const indexes = await col.indexes();
  console.log('\n--- Indexes on filelocks ---');
  console.log(indexes);

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
