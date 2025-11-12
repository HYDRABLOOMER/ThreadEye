const express = require("express");
const router = express.Router();
const multer = require("multer");
const mongoose = require("mongoose");
const { GridFSBucket } = require("mongodb");
const { File, Log } = require("../model/log");
const serverRegistry = require("../serverRegistry");

const conn = mongoose.connection;
let gfsBucket;

conn.once("open", () => {
  gfsBucket = new GridFSBucket(conn.db, { bucketName: "uploads" });
});

const storage = multer.memoryStorage();
const upload = multer({ storage });

// Check if file is text file
function isTextFile(filename, contentType) {
  const textExtensions = ['.txt', '.js', '.html', '.css', '.json', '.md', '.xml', '.csv'];
  const textTypes = ['text/', 'application/json', 'application/javascript'];
  
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return textExtensions.includes(ext) || textTypes.some(type => contentType?.startsWith(type));
}

router.post("/", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded");

  try {
    const serverId = req.body.serverId || req.headers["x-server-id"] || "main";
    if (!serverRegistry.isRunning(serverId)) {
      return res.status(409).json({ message: "Target server is offline", serverId });
    }
    const uploadedBy = req.user?.email || "admin";
    const isText = isTextFile(req.file.originalname, req.file.mimetype);
    
    if (isText) {
      // Store text files in MongoDB directly
      const fileDoc = new File({
        filename: req.file.originalname,
        originalName: req.file.originalname,
        contentType: req.file.mimetype,
        size: req.file.size,
        uploadedBy,
        uploadedServerId: serverId,
        isTextFile: true,
        content: req.file.buffer.toString('utf8')
      });
      
      await fileDoc.save();
      
      // Log the upload
      const log = new Log({
        filename: req.file.originalname,
        user: uploadedBy,
        operation: 'upload',
        timestamp: new Date(),
        status: 'success'
      });
      await log.save();
      
      res.json({ 
        message: "Text file uploaded", 
        fileId: fileDoc._id,
        filename: req.file.originalname,
        isTextFile: true
      });
    } else {
      // Store binary files in GridFS
      const uploadStream = gfsBucket.openUploadStream(req.file.originalname, {
        metadata: {
          uploadedBy,
          uploadedServerId: serverId,
          contentType: req.file.mimetype
        }
      });

      uploadStream.end(req.file.buffer);

      uploadStream.on("finish", async () => {
        // Also store metadata in MongoDB
        const fileDoc = new File({
          filename: req.file.originalname,
          originalName: req.file.originalname,
          contentType: req.file.mimetype,
          size: req.file.size,
          uploadedBy,
          uploadedServerId: serverId,
          isTextFile: false
        });
        
        await fileDoc.save();
        
        // Log the upload
        const log = new Log({
          filename: req.file.originalname,
          user: uploadedBy,
          operation: 'upload',
          timestamp: new Date(),
          status: 'success'
        });
        await log.save();
        
        res.json({ 
          message: "File uploaded", 
          fileId: uploadStream.id,
          filename: req.file.originalname,
          isTextFile: false
        });
      });

      uploadStream.on("error", (err) => {
        console.error(err);
        res.status(500).send("Upload failed");
      });
    }
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).send("Upload failed");
  }
});

module.exports = router;
