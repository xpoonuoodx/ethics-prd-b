const rateLimit = require("express-rate-limit");

// จำกัดการลองเข้าสู่ระบบ กันการเดารหัสผ่านแบบ brute-force
// 10 ครั้งต่อ 15 นาที ต่อ IP (นับเฉพาะครั้งที่ล็อกอินไม่สำเร็จ)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    message: "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณาลองใหม่อีกครั้งใน 15 นาที",
  },
});

module.exports = { loginLimiter };
