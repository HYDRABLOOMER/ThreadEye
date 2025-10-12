const express=require("express");
const cors=require("cors");
const http=require("http");
const {Server}=require("socket.io");
const mongoose=require("mongoose");
const axios=require("axios");
//routes and middleware
const authroutes = require("./routes/authroutes");
const authenticate=require("./middleware/auth");

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
app.use(express.static("src"));

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


io.on("connection",(socket)=>{
    console.log("Client connected to main server:", socket.id);
    socket.emit("updateServers", dynamicServers);
});

server.listen(4000, () => console.log("Main server running on port 4000"));

mongoose.connect("mongodb://127.0.0.1:27017/loginDB").then(()=>{
    console.log("✅ Database Connected")
}).catch(err => console.error("Database connection error"));
