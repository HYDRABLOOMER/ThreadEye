const mongoose = require('mongoose');
require('dotenv').config();
const { FileLock } = require('../model/log');

// Update MONGO_URI in .env or set MONGO_URI env var before running
// Default to the same DB the app uses (loginDB). Override with MONGO_URI environment variable if needed.
const MONGO = process.env.MONGO_URI || process.env.MONGO || 'mongodb://127.0.0.1:27017/loginDB';

async function cleanup() {
  await mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to mongo, cleaning duplicate file locks...');

  const collection = mongoose.connection.db.collection('filelocks');

  const dupes = await collection.aggregate([
    { $group: { _id: '$fileId', count: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();

  for (const d of dupes) {
    // keep the last one, remove others
    const ids = d.ids;
    const keep = ids.pop();
    if (ids.length) {
      await collection.deleteMany({ _id: { $in: ids } });
      console.log('Removed', ids.length, 'duplicate locks for fileId', d._id.toString());
    }
  }

  // Sync indexes so partial unique index is created
  try {
    await FileLock.syncIndexes();
    console.log('FileLock indexes synced');
  } catch (e) {
    console.error('Index sync failed:', e);
  }

  await mongoose.disconnect();
  console.log('Cleanup complete. Restart your server now.');
}

cleanup().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
