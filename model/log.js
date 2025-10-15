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
  uploadedAt: { type: Date, default: Date.now },
  isTextFile: Boolean,
  content: String // For text files
});

const FileLockSchema = new mongoose.Schema({
  fileId: String,
  filename: String,
  lockedBy: String,
  lockedAt: { type: Date, default: Date.now },
  socketId: String
});

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