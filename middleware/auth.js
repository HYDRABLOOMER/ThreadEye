const jwt=require("jsonwebtoken");

const authenticate=(req,res,next)=>{
    const token=req.cookies.Token;
    if(!token){
        req.user=null;
        return next();
    }
    try{
        const decoded=jwt.verify(token,"ThreadEye");
        req.user=decoded;
        next();
    }
    catch(err){
        req.user=null;
        next();
    }
}
module.exports =authenticate;