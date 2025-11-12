const express = require("express");
const bcrypt = require("bcrypt");
const User = require("../model/userModel");

const authenticate=require("../middleware/auth");
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
    
    // Update login statistics
    if (!user.statistics) {
        user.statistics = {
            totalOnlineTime: 0,
            filesHosted: 0,
            filesAccessed: 0,
            filesEdited: 0,
            lastLogin: null,
            lastLogout: null,
            sessions: []
        };
    }
    const loginTime = new Date();
    user.statistics.lastLogin = loginTime;
    user.statistics.sessions.push({
        loginTime,
        logoutTime: null,
        duration: 0
    });
    // Keep only latest 50 sessions
    if (user.statistics.sessions.length > 50) {
        user.statistics.sessions = user.statistics.sessions.slice(-50);
    }
    await user.save();
    
    const token=jwt.sign({Email:user.email,id:user._id,role: user.role},"ThreadEye",{expiresIn : "15m"})
    res.cookie("Token",token,{
        httpOnly:true,
        secure:false,
        sameSite:"Strict",
        maxAge: rememberMe?7*24*60*60*1000:undefined,
    });
    res.json({
        message:"Login Successfull",
        user: {username:user.username,email:user.email,role:user.role},
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
        const{username,email,password,role}=req.body;
        const existingUser =await User.findOne({email});
        if(existingUser){
            return res.status(400).json({
                message:"User already exist"
            });
        }
        const hashPass = await bcrypt.hash(password,10);

        const newUser = new User({username,email,password:hashPass,role:role||"user"});
        await newUser.save();

        res.json({message:"User Successfully Registered"});
    }catch(err){
        res.status(500).json({message:"Server error",error : err.message});
    }
});

router.get("/status",authenticate,(req,res)=>{
    console.log("statue route");
    if (req.user) {
        console.log("user", req.user.Email);
        return res.json({
            authenticated: true,
            user: { email: req.user.Email, id: req.user.id }
        });
    }
    res.json({
        authenticated: false
    });
});

router.post("/logout", authenticate, async (req, res) => {
    try {
        if (req.user) {
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
        res.clearCookie("Token");
        res.json({ message: "Logged out" });
    } catch (err) {
        console.error("Logout error", err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
});

// Get user statistics
router.get("/user/stats", authenticate, async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ message: "Not authenticated" });
        }
        
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        
        // Calculate total online time from sessions (ensures up-to-date)
        const baseTotal = user.statistics?.totalOnlineTime || 0;
        const sessions = (user.statistics?.sessions || []).map(session => {
            const loginTime = session.loginTime ? new Date(session.loginTime) : null;
            const logoutTime = session.logoutTime ? new Date(session.logoutTime) : null;
            let duration = session.duration || 0;
            if (loginTime && !logoutTime) {
                duration = Math.floor((Date.now() - loginTime.getTime()) / 1000);
            }
            return {
                loginTime,
                logoutTime,
                duration
            };
        });
        
        const activeSessionAddition = sessions
            .filter(session => !session.logoutTime)
            .reduce((sum, session) => sum + session.duration, 0);
        const totalOnlineTime = baseTotal + activeSessionAddition;
        
        // Get files hosted by this user
        const { File } = require("../model/log");
        const filesHosted = await File.countDocuments({ uploadedBy: user.email });
        
        // Get resource usage
        const resourceUsage = user.resourceUsage || [];
        
        res.json({
            username: user.username,
            email: user.email,
            role: user.role,
            statistics: {
                totalOnlineTime: totalOnlineTime,
                filesHosted: filesHosted,
                filesAccessed: user.statistics?.filesAccessed || 0,
                filesEdited: user.statistics?.filesEdited || 0,
                lastLogin: user.statistics?.lastLogin,
                lastLogout: user.statistics?.lastLogout,
                totalSessions: sessions.length,
                sessions
            },
            resourceUsage: resourceUsage
        });
    } catch (err) {
        console.error("Error fetching user statistics:", err);
        res.status(500).json({ message: "Server error", error: err.message });
    }
});

module.exports=router;