const mongoose = require('mongoose');

const LogSchema = new mongoose.Schema({
  filename: String,
  user: String,
  operation: String,
  timestamp: Date,
  status: String
});

const FileSchema = new mongoose.Schema({
  filename: String,
  originalName: String,
  contentType: String,
  size: Number,
  uploadedBy: String,
  uploadedServerId: String,
  uploadedAt: { type: Date, default: Date.now },
  isTextFile: Boolean,
  content: String // For text files
});

const FileLockSchema = new mongoose.Schema({
  fileId: { type: String, required: true },
  filename: String,
  // store structured lockedBy so we can report owner details
  lockedBy: {
    id: String,
    email: String,
    username: String
  },
  lockedAt: { type: Date, default: Date.now },
  socketId: String,
  lockType: { type: String, enum: ['read', 'write'], default: 'read' }, // read or write lock
  serverId: String // Which server the user is connected to
});

// Enforce exactly one lock document per fileId (DB-level enforcement).
// This makes locks exclusive: only a single lock (read or write) can exist for a file at a time.
FileLockSchema.index({ fileId: 1 }, { unique: true });

const MetricsSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  totalUsers: Number,
  activeConnections: Number,
  latency: Number,
  throughput: Number,
  filesUploaded: Number,
  activeLocks: Number
});

module.exports = {
  Log: mongoose.model('Log', LogSchema),
  File: mongoose.model('File', FileSchema),
  FileLock: mongoose.model('FileLock', FileLockSchema),
  Metrics: mongoose.model('Metrics', MetricsSchema)
};