const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { GridFSBucket, ObjectId } = require("mongodb");
const { File, FileLock, Log } = require("../model/log");
const serverRegistry = require("../serverRegistry");
const authenticate = require("../middleware/auth");

const conn = mongoose.connection;
let gfsBucket;

conn.once("open", () => {
  gfsBucket = new GridFSBucket(conn.db, { bucketName: "uploads" });
});

// Get all files (scoped to server)
router.get("/", async (req, res) => {
  try {
    const serverId = req.query.serverId || req.headers["x-server-id"] || "main";
    if (!serverRegistry.isRunning(serverId)) {
      return res.status(409).json({ message: "Target server is offline", serverId });
    }
    const files = await File.find({ uploadedServerId: serverId }).sort({ uploadedAt: -1 });
    res.json(files.map(f => ({ 
      filename: f.filename, 
      id: f._id,
      isTextFile: f.isTextFile,
      uploadedBy: f.uploadedBy,
      uploadedServerId: f.uploadedServerId,
      uploadedAt: f.uploadedAt,
      size: f.size
    })));
  } catch (err) {
    console.error("Error fetching files:", err);
    res.status(500).send("Error fetching files");
  }
});

// Get text file content for editing
router.get("/text/:id", async (req, res) => {
  try {
    const serverId = req.query.serverId || req.headers["x-server-id"] || "main";
    if (!serverRegistry.isRunning(serverId)) {
      return res.status(409).json({ message: "Target server is offline", serverId });
    }
    const file = await File.findOne({ _id: req.params.id, uploadedServerId: serverId });
    if (!file) return res.status(404).send("File not found");
    
    if (!file.isTextFile) return res.status(400).send("Not a text file");
    
    res.json({ 
      filename: file.filename,
      content: file.content,
      id: file._id
    });
  } catch (err) {
    console.error("Error fetching text file:", err);
    res.status(500).send("Error fetching file");
  }
});

// Update text file content
router.put("/text/:id", authenticate, async (req, res) => {
  try {
    const content = req.body?.content;
    const serverId = req.body?.serverId || req.headers["x-server-id"] || "main";
    const user = req.user ? req.user.Email : (req.body?.user || 'anonymous');
    if (!serverRegistry.isRunning(serverId)) {
      return res.status(409).json({ message: "Target server is offline", serverId });
    }
    const file = await File.findOne({ _id: req.params.id, uploadedServerId: serverId });
    
    if (!file) return res.status(404).send("File not found");
    if (!file.isTextFile) return res.status(400).send("Not a text file");
    
    file.content = content;
    await file.save();
    
    // Log the edit
    const log = new Log({
      filename: file.filename,
      user: user || 'anonymous',
      operation: 'edit',
      timestamp: new Date(),
      status: 'success'
    });
    await log.save();
    
    res.json({ message: "File updated successfully" });
  } catch (err) {
    console.error("Error updating file:", err);
    res.status(500).send("Error updating file");
  }
});

// Download binary file
router.get("/download/:filename", async (req, res) => {
  const serverId = req.query.serverId || req.headers["x-server-id"] || "main";
  if (!serverRegistry.isRunning(serverId)) {
    return res.status(409).json({ message: "Target server is offline", serverId });
  }
  // Ensure the file belongs to this server
  const meta = await File.findOne({ filename: req.params.filename, uploadedServerId: serverId });
  if (!meta) {
    return res.status(404).send("No file found for this server");
  }
  gfsBucket.find({ filename: req.params.filename }).toArray((err, files) => {
    if (err || !files || files.length === 0) {
      return res.status(404).send("No file found");
    }
    
    const file = files[0];
    res.set('Content-Type', file.metadata?.contentType || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename="${file.filename}"`);
    res.set('Content-Length', file.length);
    
    const downloadStream = gfsBucket.openDownloadStreamByName(req.params.filename);
    downloadStream.pipe(res);
  });
});

// Helper to normalize user value for logs
function userToString(u) {
  if (!u) return 'anonymous';
  if (typeof u === 'string') return u;
  return u.email || u.username || u.id || JSON.stringify(u);
}

// Lock file for editing (read lock by default, write lock if specified)
// Use authenticate to get current user from cookie JWT; fall back to body.user if not present
router.post("/lock/:id", authenticate, async (req, res) => {
  try {
    const fileId = req.params.id;
  const socketId = req.body?.socketId || null;
  const lockType = req.body?.lockType || 'read';
  const serverId = req.body?.serverId || 'main';
  const filename = req.body?.filename || '';

    // Resolve user from req.user (set by authenticate) or fallback to body
  const user = req.user ? { id: req.user.id, email: req.user.Email, username: req.user.username || req.user.Email } : req.body?.user;

    // If user not provided anywhere, reject
    if (!user) return res.status(400).json({ message: 'User information required to acquire lock' });

    // Enforce single active lock per file. If a lock already exists and is owned by someone else, reject.
    const existingLock = await FileLock.findOne({ fileId });
    if (existingLock) {
      // If the existing lock belongs to the same socket or same user, allow idempotent response
      if (socketId && existingLock.socketId === socketId) {
        return res.json({ message: 'You already hold the lock', lockType: existingLock.lockType });
      }
      if (existingLock.lockedBy && user && String(existingLock.lockedBy.id) === String(user.id)) {
        return res.json({ message: 'You already hold the lock', lockType: existingLock.lockType });
      }

      // Someone else holds the lock — deny any new lock (read or write)
      return res.status(409).json({ message: 'File is already locked by another user', lockedBy: existingLock.lockedBy, lockType: existingLock.lockType });
    }

    // No existing lock: create the requested lock (read or write). Unique index on fileId ensures exclusivity.
    try {
      const lockDoc = await FileLock.create({ fileId, filename, lockedBy: user, socketId, lockType, serverId });
      await Log.create({ filename, user: userToString(user), operation: `lock-${lockType}`, timestamp: new Date(), status: 'success' });
      return res.json({ message: `File ${lockType} lock acquired successfully` });
    } catch (err) {
      // If duplicate-key occurs, someone beat us to creating a lock
      if (err && (err.code === 11000 || err.codeName === 'DuplicateKey')) {
        const current = await FileLock.findOne({ fileId });
        return res.status(409).json({ message: 'File is locked by another user', lockedBy: current?.lockedBy, lockType: current?.lockType });
      }
      throw err;
    }
  } catch (err) {
    console.error('Error locking file:', err);
    return res.status(500).send('Error locking file');
  }
});

// Upgrade read lock to write lock (authenticated)
router.post("/lock/:id/upgrade", authenticate, async (req, res) => {
  try {
    const fileId = req.params.id;
  const socketId = req.body?.socketId || null;
  const user = req.user ? { id: req.user.id, email: req.user.Email, username: req.user.username || req.user.Email } : req.body?.user;

    if (!user) return res.status(400).json({ message: "User information required to upgrade lock" });

    // Check if user has a read lock
    const readLock = await FileLock.findOne({ fileId, socketId, lockType: 'read' });
    if (!readLock) {
      return res.status(404).json({ message: "You don't have a read lock on this file" });
    }

    // Ensure no other read locks exist
    const otherReadLocks = await FileLock.find({ fileId, lockType: 'read', socketId: { $ne: socketId } });
    if (otherReadLocks.length > 0) {
      return res.status(409).json({ message: 'Other users are reading this file. Cannot upgrade to write lock.', readers: otherReadLocks.map(l => l.lockedBy) });
    }

    // Attempt atomic upgrade: change this document's lockType to 'write'. Unique partial index will prevent concurrent writers.
    try {
      const upgraded = await FileLock.findOneAndUpdate(
        { _id: readLock._id, lockType: 'read', socketId },
        { $set: { lockType: 'write', lockedAt: new Date() } },
        { new: true }
      );

      if (!upgraded) return res.status(409).json({ message: 'Upgrade failed (state changed).' });

      // Double-check for concurrent readers (race window). If found, rollback and reject.
      const concurrentReaders = await FileLock.find({ fileId, lockType: 'read', socketId: { $ne: socketId } });
      if (concurrentReaders.length > 0) {
        // rollback
        await FileLock.findByIdAndUpdate(upgraded._id, { $set: { lockType: 'read' } });
        return res.status(409).json({ message: 'Cannot upgrade to write lock: other users started reading concurrently', readers: concurrentReaders.map(l => l.lockedBy) });
      }

  await Log.create({ filename: upgraded.filename, user: userToString(user), operation: 'lock-upgrade', timestamp: new Date(), status: 'success' });
      return res.json({ message: 'Lock upgraded to write lock successfully' });
    } catch (err) {
      if (err && (err.code === 11000 || err.codeName === 'DuplicateKey')) {
        const current = await FileLock.findOne({ fileId, lockType: 'write' });
        return res.status(409).json({ message: 'Upgrade failed: another user obtained the write lock', lockedBy: current?.lockedBy });
      }
      throw err;
    }
  } catch (err) {
    console.error('Error upgrading lock:', err);
    return res.status(500).send('Error upgrading lock');
  }
});

// Unlock file (by socketId if provided, otherwise by locker or admin)
router.post("/unlock/:id", authenticate, async (req, res) => {
  try {
    const fileId = req.params.id;
  const socketId = req.body?.socketId || null;
  const serverId = req.body?.serverId || null;

    // resolve user from req.user
  const user = req.user ? { id: req.user.id, email: req.user.Email, username: req.user.username || req.user.Email, role: req.user.role } : null;

    let query;
    if (socketId) {
      query = { fileId, socketId };
    } else if (user) {
      // only the locker or admin can unlock via this path
      const current = await FileLock.findOne({ fileId });
      if (!current) return res.status(404).json({ message: 'Lock not found' });
      if (user.role !== 'admin' && String(current.lockedBy?.id) !== String(user.id)) {
        return res.status(403).json({ message: 'Not allowed to unlock', lockedBy: current.lockedBy });
      }
      query = { fileId };
      if (serverId) query.serverId = serverId;
    } else {
      return res.status(400).json({ message: 'User information required to unlock' });
    }

    const lock = await FileLock.findOne(query);
    if (!lock) return res.status(404).json({ message: 'Lock not found' });
    await FileLock.deleteMany(query);

  await Log.create({ filename: lock.filename, user: userToString(user || lock.lockedBy), operation: 'unlock', timestamp: new Date(), status: 'success' });

    return res.json({ message: 'File unlocked successfully' });
  } catch (err) {
    console.error('Error unlocking file:', err);
    return res.status(500).send('Error unlocking file');
  }
});

// Get active locks
router.get("/locks", async (req, res) => {
  try {
    const locks = await FileLock.find().sort({ lockedAt: -1 });
    res.json(locks);
  } catch (err) {
    console.error("Error fetching locks:", err);
    res.status(500).send("Error fetching locks");
  }
});

// Get resource allocation data (for admin dashboard)
router.get("/resources/allocation", async (req, res) => {
  try {
    const locks = await FileLock.find().populate('fileId');
    const resourceAllocation = {};
    
    locks.forEach(lock => {
      const key = `${lock.lockedBy}_${lock.serverId || 'main'}`;
      if (!resourceAllocation[key]) {
        resourceAllocation[key] = {
          user: lock.lockedBy,
          serverId: lock.serverId || 'main',
          files: [],
          readLocks: 0,
          writeLocks: 0
        };
      }
      
      resourceAllocation[key].files.push({
        fileId: lock.fileId,
        filename: lock.filename,
        lockType: lock.lockType,
        lockedAt: lock.lockedAt
      });
      
      if (lock.lockType === 'read') {
        resourceAllocation[key].readLocks++;
      } else {
        resourceAllocation[key].writeLocks++;
      }
    });
    
    res.json(Object.values(resourceAllocation));
  } catch (err) {
    console.error("Error fetching resource allocation:", err);
    res.status(500).send("Error fetching resource allocation");
  }
});

module.exports = router;
