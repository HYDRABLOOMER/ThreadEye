const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { GridFSBucket, ObjectId } = require("mongodb");
const { File, FileLock, Log } = require("../model/log");

const conn = mongoose.connection;
let gfsBucket;

conn.once("open", () => {
  gfsBucket = new GridFSBucket(conn.db, { bucketName: "uploads" });
});

// Get all files
router.get("/", async (req, res) => {
  try {
    const files = await File.find().sort({ uploadedAt: -1 });
    res.json(files.map(f => ({ 
      filename: f.filename, 
      id: f._id,
      isTextFile: f.isTextFile,
      uploadedBy: f.uploadedBy,
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
    const file = await File.findById(req.params.id);
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
router.put("/text/:id", async (req, res) => {
  try {
    const { content, user } = req.body;
    const file = await File.findById(req.params.id);
    
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
router.get("/download/:filename", (req, res) => {
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

// Lock file for editing
router.post("/lock/:id", async (req, res) => {
  try {
    const { user, socketId } = req.body;
    const fileId = req.params.id;
    
    // Check if file is already locked
    const existingLock = await FileLock.findOne({ fileId });
    if (existingLock) {
      return res.status(409).json({ 
        message: "File is already locked", 
        lockedBy: existingLock.lockedBy 
      });
    }
    
    // Create new lock
    const lock = new FileLock({
      fileId,
      filename: req.body.filename,
      lockedBy: user,
      socketId
    });
    
    await lock.save();
    
    // Log the lock
    const log = new Log({
      filename: req.body.filename,
      user: user,
      operation: 'lock',
      timestamp: new Date(),
      status: 'success'
    });
    await log.save();
    
    res.json({ message: "File locked successfully" });
  } catch (err) {
    console.error("Error locking file:", err);
    res.status(500).send("Error locking file");
  }
});

// Unlock file
router.post("/unlock/:id", async (req, res) => {
  try {
    const { user, socketId } = req.body;
    const fileId = req.params.id;
    
    const lock = await FileLock.findOne({ fileId, socketId });
    if (!lock) {
      return res.status(404).send("Lock not found");
    }
    
    await FileLock.deleteOne({ fileId, socketId });
    
    // Log the unlock
    const log = new Log({
      filename: lock.filename,
      user: user,
      operation: 'unlock',
      timestamp: new Date(),
      status: 'success'
    });
    await log.save();
    
    res.json({ message: "File unlocked successfully" });
  } catch (err) {
    console.error("Error unlocking file:", err);
    res.status(500).send("Error unlocking file");
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

module.exports = router;
