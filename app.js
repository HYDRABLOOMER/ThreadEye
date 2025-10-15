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

app.use("/api/auth",authroutes);
//upload and fetch files
app.use("/upload",uploadRoutes);
app.use('/files',fileRoutes);

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
    const newServer = { host, port, location, name: `Server-${port}` };
    dynamicServers.push(newServer);
    io.emit("updateServers", dynamicServers);
    res.json({ message: `Server started at ${host}:${port}`, ...newServer });
  });
});


// Store connected users and their info
const connectedUsers = new Map();
let metricsInterval;

io.on("connection",(socket)=>{
    console.log("Client connected to main server:", socket.id);
    socket.emit("updateServers", dynamicServers);
    
    // Store user info
    socket.on("userInfo", (userInfo) => {
        connectedUsers.set(socket.id, {
            ...userInfo,
            connectedAt: new Date(),
            socketId: socket.id
        });
        updateMetrics();
    });
    
    // Handle file editing events
    socket.on("joinFileEdit", async (data) => {
        const { fileId, filename, user } = data;
        
        try {
            // Check if file is already locked
            const existingLock = await FileLock.findOne({ fileId });
            if (existingLock && existingLock.socketId !== socket.id) {
                socket.emit("fileLocked", { 
                    message: "File is already being edited", 
                    lockedBy: existingLock.lockedBy 
                });
                return;
            }
            
            // Join room for this file
            socket.join(`file-${fileId}`);
            
            // Create lock if not exists
            if (!existingLock) {
                const lock = new FileLock({
                    fileId,
                    filename,
                    lockedBy: user,
                    socketId: socket.id
                });
                await lock.save();
            }
            
            socket.emit("fileEditJoined", { fileId, filename });
            io.emit("fileLockUpdate", await FileLock.find());
            
        } catch (error) {
            console.error("Error joining file edit:", error);
            socket.emit("error", { message: "Failed to join file editing" });
        }
    });
    
    socket.on("fileContentChange", (data) => {
        const { fileId, content, user } = data;
        socket.to(`file-${fileId}`).emit("fileContentUpdate", { content, user });
    });
    
    socket.on("leaveFileEdit", async (data) => {
        const { fileId } = data;
        socket.leave(`file-${fileId}`);
        
        try {
            // Remove lock
            await FileLock.deleteOne({ socketId: socket.id });
            io.emit("fileLockUpdate", await FileLock.find());
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
      io.emit("updateServers", dynamicServers);
      return res.json({ message: `Server on port ${port} stopped successfully` });
    });
  } else {
    dynamicServers.splice(serverIndex, 1);
    io.emit("updateServers", dynamicServers);
    return res.json({ message: `Server on port ${port} removed from list` });
  }
});



server.listen(4000, () => console.log("Main server running on port 4000"));

mongoose.connect("mongodb://127.0.0.1:27017/loginDB").then(()=>{
    console.log("✅ Database Connected")
}).catch(err => console.error("Database connection error"));
