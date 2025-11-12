const express=require("express");
const cors=require("cors");
const http=require("http");
const {Server}=require("socket.io");
const mongoose=require("mongoose");
const axios=require("axios");

//upload files 
const multer =require('multer');
const Grid=require('gridfs-stream');

//routes and middleware
const authroutes = require("./routes/authroutes");
const authenticate=require("./middleware/auth");
const uploadRoutes=require('./routes/uploadRoutes');
const fileRoutes=require('./routes/fileRoutes');
const { Metrics, FileLock } = require('./model/log');
const serverRegistry = require('./serverRegistry');

const path=require("path");
const cookieParser = require("cookie-parser");

const app=express();
const server=http.createServer(app);
const io=new Server(server,{
    cors:{
        origin:"*"
    }
});

let dynamicServers=[];
let basePort = 5000;

app.use(express.json());
app.use(cors());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "src")));

app.get("/",(req,res)=>{
    res.sendFile(path.join(__dirname,"src","login.html"));
})
app.get("/signup",(req,res)=>{
    res.sendFile(path.join(__dirname,"src","signup.html"));
})
app.get("/profile",authenticate,(req,res)=>{
    res.sendFile(path.join(__dirname,"src","profile.html"));
})
app.get("/admindash",authenticate,(req,res)=>{
    res.sendFile(path.join(__dirname,"src","serverdash.html"));
})
app.get("/userdash",authenticate,(req,res)=>{
    res.sendFile(path.join(__dirname,"src","userdash.html"));
})

// Logout route (GET) - clears cookie and redirects
app.get("/logout", authenticate, async (req, res) => {
    try {
        if (req.user) {
            const User = require("./model/userModel");
            const user = await User.findById(req.user.id);
            if (user && user.statistics && user.statistics.sessions?.length) {
                const sessions = user.statistics.sessions;
                const activeSession = [...sessions].reverse().find(s => !s.logoutTime);
                if (activeSession) {
                    const logoutTime = new Date();
                    activeSession.logoutTime = logoutTime;
                    activeSession.duration = Math.floor((logoutTime - new Date(activeSession.loginTime)) / 1000);
                    user.statistics.lastLogout = logoutTime;
                    user.statistics.totalOnlineTime = (user.statistics.totalOnlineTime || 0) + activeSession.duration;
                    await user.save();
                }
            }
        }
    } catch (err) {
        console.error("Error updating logout stats:", err);
    }
    res.clearCookie("Token");
    res.redirect("/login");
});

app.use("/api/auth",authroutes);
//upload and fetch files (protected)
app.use("/upload", authenticate, uploadRoutes);
app.use('/files', authenticate, fileRoutes);

// Get resource allocation (for admin dashboard)
app.get("/api/resources/allocation", authenticate, async (req, res) => {
    try {
        const allocation = await getResourceAllocation();
        res.json(allocation);
    } catch (error) {
        console.error("Error fetching resource allocation:", error);
        res.status(500).json({ message: "Error fetching resource allocation" });
    }
});

// app.get("/start", async (req, res) => {
//   const port = basePort + dynamicServers.length;
//   const host = "127.0.0.1";
//   let location = { lat: null, lng: null };

//   try {
//     const locRes = await axios.get("http://ip-api.com/json/");
//     location.lat = locRes.data.lat;
//     location.lng = locRes.data.lon;
//   } catch (err) {
//     console.error("Location fetch error:", err.message);
//   }

//   const dynamicServer = http.createServer();
//   const dynamicIo = new Server(dynamicServer, {
//     cors: { origin: "*" }
//   });

//   dynamicIo.on("connection", (socket) => {
//     console.log(`Client connected to dynamic server ${host}:${port} - ${socket.id}`);
//     socket.on("message", (msg) => socket.broadcast.emit("message", msg));
//   });

//   dynamicServer.listen(port, () => {
//     console.log(`Dynamic server running at ${host}:${port}`);
//     const newServer = { host, port, location, name: `Server-${port}` };
//     dynamicServers.push(newServer);
//     io.emit("updateServers", dynamicServers); // send all servers to clients
//     res.json({ message: `Server started at ${host}:${port}`, ...newServer });
//   });
// });

//new
app.post("/start", async (req, res) => {
  const port = basePort + dynamicServers.length;
  const host = "127.0.0.1";
  const { lat, lng } = req.body;

  const location = { lat, lng };

  const dynamicServer = http.createServer();
  const dynamicIo = new Server(dynamicServer, { cors: { origin: "*" } });

  dynamicIo.on("connection", (socket) => {
    console.log(`Client connected to dynamic server ${host}:${port} - ${socket.id}`);
    socket.on("message", (msg) => socket.broadcast.emit("message", msg));
  });

  dynamicServer.listen(port, () => {
    console.log(`Dynamic server running at ${host}:${port}`);
    const newServer = { host, port, location, name: `Server-${port}`, id: `Server-${port}` };
    dynamicServers.push(newServer);
    serverRegistry.addServer(newServer);
    io.emit("updateServers", serverRegistry.listServers());
    res.json({ message: `Server started at ${host}:${port}`, ...newServer });
  });
});


// Store connected users and their info
const connectedUsers = new Map();
let metricsInterval;

// Helper function to get resource allocation
async function getResourceAllocation() {
    const locks = await FileLock.find();
    const allocation = {};
    
    locks.forEach(lock => {
        const key = `${lock.lockedBy}_${lock.serverId || 'main'}`;
        if (!allocation[key]) {
            allocation[key] = {
                user: lock.lockedBy,
                serverId: lock.serverId || 'main',
                files: [],
                readLocks: 0,
                writeLocks: 0
            };
        }
        
        allocation[key].files.push({
            fileId: lock.fileId,
            filename: lock.filename,
            lockType: lock.lockType
        });
        
        if (lock.lockType === 'read') {
            allocation[key].readLocks++;
        } else {
            allocation[key].writeLocks++;
        }
    });
    
    return Object.values(allocation);
}

io.on("connection",(socket)=>{
    console.log("Client connected to main server:", socket.id);
    socket.emit("updateServers", serverRegistry.listServers());
    
    // Store user info
    socket.on("userInfo", (userInfo) => {
        connectedUsers.set(socket.id, {
            ...userInfo,
            connectedAt: new Date(),
            socketId: socket.id
        });
        updateMetrics();
    });
    
    // Handle file editing events - read lock by default
    socket.on("joinFileEdit", async (data) => {
        const { fileId, filename, user, lockType = 'read', serverId } = data;

        try {
            // Join room for this file
            socket.join(`file-${fileId}`);

            // Enforce single active lock document per file. If a lock already exists and belongs to someone else, deny.
            const existingLock = await FileLock.findOne({ fileId });
            if (existingLock) {
                if (existingLock.socketId === socket.id || (existingLock.lockedBy && user && String(existingLock.lockedBy.id) === String(user.id))) {
                    // idempotent: same owner re-joining
                    socket.emit('fileEditJoined', { fileId, filename, lockType: existingLock.lockType });
                    io.emit('fileLockUpdate', await FileLock.find());
                    io.emit('resourceAllocationUpdate', await getResourceAllocation());
                    return;
                }

                // somebody else holds the lock
                socket.emit('fileLocked', { message: 'File is already locked by another user', lockedBy: existingLock.lockedBy, lockType: existingLock.lockType });
                return;
            }

            // No existing lock: create the lock requested by client (read or write). Unique index ensures exclusivity.
            try {
                await FileLock.create({ fileId, filename, lockedBy: user, socketId: socket.id, lockType, serverId: serverId || 'main' });
                socket.emit('fileEditJoined', { fileId, filename, lockType });
                io.emit('fileLockUpdate', await FileLock.find());
                io.emit('resourceAllocationUpdate', await getResourceAllocation());
                return;
            } catch (err) {
                if (err && (err.code === 11000 || err.codeName === 'DuplicateKey')) {
                    const current = await FileLock.findOne({ fileId });
                    socket.emit('fileLocked', { message: 'File is locked by another user', lockedBy: current?.lockedBy, lockType: current?.lockType });
                    return;
                }
                console.error('Error creating lock:', err);
                socket.emit('error', { message: 'Failed to acquire lock' });
                return;
            }

        } catch (error) {
            console.error('Error joining file edit:', error);
            socket.emit('error', { message: 'Failed to join file editing' });
        }
    });
    
    socket.on("fileContentChange", async (data) => {
        const { fileId, content, user } = data;
        try {
            // Only allow edits from the socket that holds a write lock for this file
            const writeLock = await FileLock.findOne({ fileId, socketId: socket.id, lockType: 'write' });
            if (!writeLock) {
                // Reject edits from non-writers
                socket.emit('error', { message: 'Edit denied: you must hold a write lock to modify this file' });
                return;
            }

            // Broadcast update to other clients in the file room
            socket.to(`file-${fileId}`).emit("fileContentUpdate", { content, user });
        } catch (err) {
            console.error('Error handling fileContentChange:', err);
            socket.emit('error', { message: 'Server error while processing edit' });
        }
    });
    
    socket.on("upgradeToWriteLock", async (data) => {
        const { fileId, user } = data;

        try {
            const readLock = await FileLock.findOne({ fileId, socketId: socket.id, lockType: 'read' });
            if (!readLock) {
                socket.emit('error', { message: "You don't have a read lock on this file" });
                return;
            }

            // Check for other read locks
            const otherReadLocks = await FileLock.find({ fileId, lockType: 'read', socketId: { $ne: socket.id } });
            if (otherReadLocks.length > 0) {
                socket.emit('error', { message: 'Other users are reading this file. Cannot upgrade to write lock.', readers: otherReadLocks.map(l => l.lockedBy) });
                return;
            }

            // Attempt atomic upgrade using findOneAndUpdate to set lockType to 'write'
            try {
                const upgraded = await FileLock.findOneAndUpdate(
                    { _id: readLock._id, lockType: 'read', socketId: socket.id },
                    { $set: { lockType: 'write', lockedAt: new Date() } },
                    { new: true }
                );

                if (!upgraded) {
                    socket.emit('error', { message: 'Upgrade failed (state changed)' });
                    return;
                }

                // Double-check concurrent readers
                const concurrentReaders = await FileLock.find({ fileId, lockType: 'read', socketId: { $ne: socket.id } });
                if (concurrentReaders.length > 0) {
                    // rollback
                    await FileLock.findByIdAndUpdate(upgraded._id, { $set: { lockType: 'read' } });
                    socket.emit('error', { message: 'Cannot upgrade to write lock: other users started reading concurrently', readers: concurrentReaders.map(l => l.lockedBy) });
                    return;
                }

                socket.emit('lockUpgraded', { fileId, lockType: 'write' });
                io.emit('fileLockUpdate', await FileLock.find());
                io.emit('resourceAllocationUpdate', await getResourceAllocation());
            } catch (err) {
                if (err && (err.code === 11000 || err.codeName === 'DuplicateKey')) {
                    const current = await FileLock.findOne({ fileId, lockType: 'write' });
                    socket.emit('error', { message: 'Upgrade failed: another user obtained the write lock', lockedBy: current?.lockedBy });
                    return;
                }
                throw err;
            }
        } catch (error) {
            console.error('Error upgrading lock:', error);
            socket.emit('error', { message: 'Failed to upgrade lock' });
        }
    });
    
    socket.on("leaveFileEdit", async (data) => {
        const { fileId } = data;
        socket.leave(`file-${fileId}`);
        
        try {
            // Remove lock
            await FileLock.deleteOne({ socketId: socket.id, fileId });
            io.emit("fileLockUpdate", await FileLock.find());
            io.emit("resourceAllocationUpdate", await getResourceAllocation());
        } catch (error) {
            console.error("Error leaving file edit:", error);
        }
    });
    
    socket.on("disconnect", async () => {
        console.log("Client disconnected:", socket.id);
        
        // Remove user from connected users
        connectedUsers.delete(socket.id);
        
        // Remove any locks held by this socket
        try {
            await FileLock.deleteMany({ socketId: socket.id });
            io.emit("fileLockUpdate", await FileLock.find());
        } catch (error) {
            console.error("Error cleaning up locks:", error);
        }
        
        updateMetrics();
    });
});

// Update metrics every 30 seconds
function updateMetrics() {
    const totalUsers = connectedUsers.size;
    const activeConnections = io.engine.clientsCount;
    
    // Calculate latency (simplified - in real app you'd ping clients)
    const latency = Math.random() * 50 + 10; // Mock latency
    
    // Calculate throughput (requests per second - simplified)
    const throughput = Math.random() * 100 + 50; // Mock throughput
    
    const metrics = new Metrics({
        totalUsers,
        activeConnections,
        latency,
        throughput,
        filesUploaded: 0, // This would be tracked separately
        activeLocks: 0 // This would be updated from FileLock count
    });
    
    metrics.save().catch(err => console.error("Error saving metrics:", err));
    
    // Emit metrics to admin dashboard
    io.emit("metricsUpdate", {
        totalUsers,
        activeConnections,
        latency,
        throughput,
        timestamp: new Date()
    });
}

// Start metrics collection
if (!metricsInterval) {
    metricsInterval = setInterval(updateMetrics, 30000); // Every 30 seconds
}

app.post("/stop", (req, res) => {
  const { port } = req.body;
  const serverIndex = dynamicServers.findIndex(s => s.port === port);

  if (serverIndex === -1) return res.status(404).json({ message: "Server not found" });

  const serverObj = dynamicServers[serverIndex];
  if (serverObj.instance) {
    serverObj.instance.close(() => {
      dynamicServers.splice(serverIndex, 1);
      serverRegistry.removeServerByPort(port);
      io.emit("updateServers", serverRegistry.listServers());
      return res.json({ message: `Server on port ${port} stopped successfully` });
    });
  } else {
    dynamicServers.splice(serverIndex, 1);
    serverRegistry.removeServerByPort(port);
    io.emit("updateServers", serverRegistry.listServers());
    return res.json({ message: `Server on port ${port} removed from list` });
  }
});



server.listen(4000, () => console.log("Main server running on port 4000"));

mongoose.connect("mongodb://127.0.0.1:27017/loginDB").then(()=>{
    console.log("✅ Database Connected")
}).catch(err => console.error("Database connection error"));
