const express = require("express");
const authControllers = require("../controllers/authControllers");
const { verifyToken } = require("../middlewares/authMiddlewares");
const {
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  lineAuthLimiter,
} = require("../middlewares/rateLimitMiddlewares");
const router = express.Router();

router.post("/login", loginLimiter, authControllers.login);

// ลงทะเบียนผู้ใช้งานใหม่
router.post("/register", registerLimiter, authControllers.register);

// ยืนยันอีเมล (เมื่อผู้ใช้คลิกลิงก์จากอีเมล)
// เราใช้ GET เพราะเป็นการคลิกผ่านลิงก์ในเบราว์เซอร์
router.get("/verify-email", authControllers.verifyEmail);

// 1. เส้นทางสำหรับรับอีเมลเพื่อขอ Reset Password
router.post(
  "/forgot-password",
  forgotPasswordLimiter,
  authControllers.forgotPassword,
);

// 2. เส้นทางสำหรับบันทึกรหัสผ่านใหม่ (Reset จริงๆ)
router.post(
  "/reset-password",
  resetPasswordLimiter,
  authControllers.resetPassword,
);

// ดึงข้อมูลบัญชีของตัวเอง (ใช้เก็บลง localStorage ฝั่งหน้าเว็บ หลัง login ผ่าน LINE)
router.get("/me", verifyToken, authControllers.getMe);

// --- LINE Login ---
router.get("/line/login", lineAuthLimiter, authControllers.lineLogin);
router.get("/line/callback", lineAuthLimiter, authControllers.lineCallback);
router.get(
  "/line/pending/:id",
  lineAuthLimiter,
  authControllers.getLinePendingSignup,
);
router.post(
  "/line/complete-register",
  lineAuthLimiter,
  authControllers.completeLineRegister,
);

module.exports = router;
