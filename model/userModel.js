const mongoose=require("mongoose");

const userSchema=new mongoose.Schema({
    username:{
        type:String,
        required:true
    },
    email:{
        type:String,
        required:true
    },
    password:{
        type:String,
        required:true
    },
    role: {
        type:String,
        enum:["admin","user"],
        default:"user",
    },
    statistics: {
        totalOnlineTime: { type: Number, default: 0 }, // in seconds
        filesHosted: { type: Number, default: 0 },
        filesAccessed: { type: Number, default: 0 },
        filesEdited: { type: Number, default: 0 },
        lastLogin: Date,
        lastLogout: Date,
        sessions: [{
            loginTime: Date,
            logoutTime: Date,
            duration: Number // in seconds
        }]
    },
    resourceUsage: [{
        resourceId: String, // fileId or serverId
        resourceType: { type: String, enum: ['file', 'server'] },
        accessCount: { type: Number, default: 0 },
        lastAccessed: Date,
        totalTimeSpent: { type: Number, default: 0 } // in seconds
    }]
},
    {timestamps:true}
);
module.exports = mongoose.model("User",userSchema);