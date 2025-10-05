const express=require("express");
const cors=require("cors");
const mongoose=require("mongoose");

//routes and middleware
const authroutes = require("./routes/authroutes");
const authenticate=require("./middleware/auth");

const path=require("path");
const cookieParser = require("cookie-parser");
const app=express();
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
app.get("/dash",authenticate,(req,res)=>{
    res.sendFile(path.join(__dirname,"src","serverdash.html"));
})
app.use("/api/auth",authroutes);

mongoose.connect("mongodb://127.0.0.1:27017/loginDB").then(()=>{
    console.log("✅ Database Connected")
}).catch(err => console.error("Database connection error"));
app.listen(4000,()=>{
    console.log("server running at port : 4000")
})