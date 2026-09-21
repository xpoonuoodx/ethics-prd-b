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

// กันสมัครสมาชิกปลอมจำนวนมาก (mass account creation)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "สมัครสมาชิกบ่อยเกินไป กรุณาลองใหม่อีกครั้งภายหลัง",
  },
});

// กันสแปมอีเมลรีเซ็ตรหัสผ่านไปหาอีเมลจริงของคนอื่น (email bombing)
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "ขอลิงก์รีเซ็ตรหัสผ่านบ่อยเกินไป กรุณาลองใหม่อีกครั้งภายหลัง",
  },
});

// กันเดา/สแปม endpoint ตั้งรหัสผ่านใหม่
const resetPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "ทำรายการบ่อยเกินไป กรุณาลองใหม่อีกครั้งภายหลัง",
  },
});

// กันไล่ยิงเลขที่ใบเซอร์ (เลขรันต่อเนื่อง เดาได้) มากวาดชื่อ-นามสกุลจริงของผู้ได้ใบเซอร์ทั้งหมด
const verifyCertLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "ตรวจสอบใบประกาศบ่อยเกินไป กรุณาลองใหม่อีกครั้งภายหลัง",
  },
});

// กันสแปมเข้า/สมัครผ่าน LINE (ทั้งกดปุ่มเริ่ม, callback ที่ LINE เรียกกลับมา, และตอนกดยืนยัน
// สมัครจริง) ใจกว้างกว่า login/register ปกติหน่อยเพราะ callback อาจถูกเรียกซ้ำได้เองจาก
// พฤติกรรมปกติของ browser (เช่น refresh หน้า)
const lineAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "ทำรายการผ่าน LINE บ่อยเกินไป กรุณาลองใหม่อีกครั้งภายหลัง",
  },
});

module.exports = {
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  verifyCertLimiter,
  lineAuthLimiter,
};
