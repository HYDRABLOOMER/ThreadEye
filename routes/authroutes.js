const express = require("express");
const bcrypt = require("bcrypt");
const User = require("../model/userModel");
const jwt=require("jsonwebtoken");

const router =express.Router();

router.post("/login",async (req,res) => {
    try{
        const {email,password,rememberMe}=req.body;
        console.log("request body",req.body);
        const user=await User.findOne({email});
        if(!user)return res.status(400).json({message:"User not found"});
    const isMatch =await bcrypt.compare(password,user.password);
    if(!isMatch) return res.status(400).json({message:"Invalid Credentials"})
    const token=jwt.sign({email},"ThreadEye",{expiresIn : "15m"})
    res.cookie("Token",token,{
        httpOnly:true,
        secure:false,
        sameSite:"Strict",
        maxAge: rememberMe?7*24*60*60*1000:undefined
    });
    res.json({
        message:"Login Successfull",
        user: {username:user.username,email:user.email}
        });
    }catch(err){
        console.log("mongoose error",err);
        res.status(500).json({
            message:"server error authroutes(login)",
            error:err.message
        });
    }
});

router.post("/signup",async(req,res)=>{
    try{
        const{username,email,password}=req.body;
        const existingUser =await User.findOne({email});
        if(existingUser){
            return res.status(400).json({
                message:"User already exist"
            });
        }
        const hashPass = await bcrypt.hash(password,10);

        const newUser = new User({username,email,password:hashPass});
        await newUser.save();

        res.json({message:"User Successfully Registered"});
    }catch(err){
        res.status(500).json({message:"Server error",error : err.message});
    }
});

module.exports=router;