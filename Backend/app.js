const express=require("express");
const path=require("path");
app=express();
app.get("/",(req,res)=>{
    res.sendFile(path.join(__dirname,"..","src","main.html"));
})
app.listen()