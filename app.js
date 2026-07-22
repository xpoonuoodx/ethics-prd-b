const express = require("express");
const cors = require("cors");
const { swaggerUi, swaggerSpec } = require("./config/swagger");

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const adminRoutes = require("./routes/adminRoutes");
const regulatorRoutes = require("./routes/regulatorRoutes");
const publicRoutes = require("./routes/publicRoutes");
// const masterRoutes = require('./routes/masterRoutes');
// const homeRoutes = require('./routes/homeRoutes')

const app = express();

/**
 * @swagger
 * tags:
 * - name: Auth
 * description: ระบบยืนยันตัวตน (Login/Register)
 * - name: User
 * description: ระบบสำหรับเกษตรกร (Plots/Planting/Trading)
 * - name: Admin
 * description: ระบบสำหรับผู้ดูแล (Hotspot Analysis/Dashboard)
 */

// Middleware
// จำกัด CORS ให้เหลือเฉพาะ origin ของหน้าเว็บเราเอง (กัน frontend อื่นแอบยิง API เราจาก browser ของ user)
// รองรับหลาย origin คั่นด้วยจุลภาคใน MYAPP_FRONTEND_URL เช่น "https://app.example.com,https://staging.example.com"
const allowedOrigins = (process.env.MYAPP_FRONTEND_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // อนุญาต request ที่ไม่มี origin เช่น curl, Postman, server-to-server
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Swagger documentation
app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, { explorer: true }),
);

// Routes
// app.use('/', homeRoutes);
app.use('/public', publicRoutes);
app.use("/auth", authRoutes);
app.use("/user", userRoutes);
app.use("/admin", adminRoutes);
app.use("/regulator", regulatorRoutes);
////
// app.use('/master', masterRoutes);

// Error handler กลาง: กันไม่ให้ stack trace / path ของเซิร์ฟเวอร์หลุดออกไปกับ response
// (ครอบคลุมทั้ง error จาก CORS middleware ด้านบนและ error อื่นๆ ที่ไม่ถูกจับใน controller)
app.use((err, req, res, next) => {
  if (err && err.message === "Not allowed by CORS") {
    return res.status(403).json({ message: "Origin นี้ไม่ได้รับอนุญาตให้เข้าถึง API" });
  }
  console.error("Unhandled Error:", err);
  res.status(500).json({ message: "เกิดข้อผิดพลาดจากเซิร์ฟเวอร์" });
});

module.exports = app;
