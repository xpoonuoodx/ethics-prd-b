//Create by Nattawut.C 11/11/24
require("dotenv").config(); // 1. บังคับโหลดไฟล์ .env ป้องกันตัวแปร Secret Key หาย
const jwt = require("jsonwebtoken");

const verifyToken = (req, res, next) => {
  // 2. รับ Token จาก Header (รูปแบบ: Bearer <token>)
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    console.error("❌ [Auth] Error: ไม่พบ Token ใน Header (ไม่มีคนส่งมา)");
    return res
      .status(401)
      .json({ message: "Access Denied. No token provided." });
  }

  try {
    // 3. ดึง Secret Key
    const secretKey = process.env.MYAPP_JWT_SECRET || process.env.JWT_SECRET;

    // เช็คความปลอดภัย: ป้องกันกรณี Backend หา Secret Key ไม่เจอ
    if (!secretKey) {
      console.error("❌ [Auth] Error: หาตัวแปร Secret Key ใน .env ไม่เจอ!");
      return res
        .status(500)
        .json({ message: "Server configuration error. Secret key missing." });
    }

    // 4. ถอดรหัสและตรวจสอบ Token
    const decoded = jwt.verify(token, secretKey);

    // 5. เก็บข้อมูลที่ถอดรหัสได้ (เช่น id, role) ไว้ใน req.user
    req.user = decoded;

    // ผ่าน! ส่งให้ Middleware หรือ Controller ตัวถัดไปทำงาน
    next();
  } catch (err) {
    // พิมพ์ Log ใน Terminal ของ Backend เพื่อให้เรารู้ว่ามันพังเพราะอะไรจริงๆ
    console.error(`❌ [Auth] Token Error: ${err.name} - ${err.message}`);

    // 6. ดักจับ Error ตามประเภท
    if (err.name === "TokenExpiredError") {
      // กรณี Token หมดอายุ
      return res
        .status(401)
        .json({ message: "Token expired. Please log in again." });
    }

    if (err.name === "JsonWebTokenError") {
      // กรณี Token ไม่ถูกต้อง หรือ โดนดัดแปลง
      return res
        .status(403)
        .json({ message: "Invalid token.", error: err.message });
    }

    // กรณี Error อื่นๆ ที่คาดไม่ถึง
    return res
      .status(403)
      .json({ message: "Authentication failed.", error: err.message });
  }
};

// ต้องใช้ต่อจาก verifyToken เสมอ (พึ่ง req.user ที่ verifyToken ใส่ไว้ให้)
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Access Denied. Insufficient permissions." });
    }
    next();
  };
};

module.exports = { verifyToken, requireRole };
