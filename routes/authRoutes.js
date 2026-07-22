const express = require("express");
const authControllers = require("../controllers/authControllers");
const { loginLimiter } = require("../middlewares/rateLimitMiddlewares");
const router = express.Router();

router.post("/login", loginLimiter, authControllers.login);

// ลงทะเบียนผู้ใช้งานใหม่
router.post("/register", authControllers.register);

// ยืนยันอีเมล (เมื่อผู้ใช้คลิกลิงก์จากอีเมล)
// เราใช้ GET เพราะเป็นการคลิกผ่านลิงก์ในเบราว์เซอร์
router.get("/verify-email", authControllers.verifyEmail);

// 1. เส้นทางสำหรับรับอีเมลเพื่อขอ Reset Password
router.post("/forgot-password", authControllers.forgotPassword);

// 2. เส้นทางสำหรับบันทึกรหัสผ่านใหม่ (Reset จริงๆ)
router.post("/reset-password", authControllers.resetPassword);

module.exports = router;