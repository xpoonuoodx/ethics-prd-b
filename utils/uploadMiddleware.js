const multer = require("multer");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

// เก็บรูปโปรไฟล์ไว้บน disk ของเซิร์ฟเวอร์เอง (ไม่ใช้ cloud storage ภายนอก) เพราะ backend deploy
// เป็น VM ที่มี disk ถาวรจริง ไม่ใช่ serverless ที่ไฟล์หายทุกครั้งที่ deploy ใหม่ - โฟลเดอร์นี้ใช้ได้
// เหมือนกันทั้งตอนรัน localhost และตอน deploy จริง ไม่ต้องแยก config
const UPLOAD_DIR = path.join(__dirname, "..", "uploads", "profile-images");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME_TYPES = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

// 2MB ต่อรูป - เพียงพอมากสำหรับรูปโปรไฟล์ที่บีบอัดแล้ว กันคนอัปโหลดไฟล์ใหญ่เปลืองพื้นที่ VM
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  // ตั้งชื่อไฟล์ใหม่แบบสุ่มเสมอ ห้ามใช้ชื่อไฟล์เดิมจาก client (กันชื่อซ้ำ/path traversal/เดาไฟล์คนอื่น)
  filename: (req, file, cb) => {
    const ext = ALLOWED_MIME_TYPES[file.mimetype] || path.extname(file.originalname);
    cb(null, `${crypto.randomBytes(16).toString("hex")}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES[file.mimetype]) {
    return cb(new Error("รองรับเฉพาะไฟล์รูปภาพ .jpg .png .webp เท่านั้น"));
  }
  cb(null, true);
};

const uploadProfileImage = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

// ครอบ multer.single() ให้เป็น middleware ธรรมดาที่ error ออกมาเป็น JSON ที่อ่านรู้เรื่อง
// (ไม่งั้น error จาก multer เช่นไฟล์ใหญ่เกิน/ชนิดไฟล์ผิด จะหลุดไปให้ error handler กลางของ
// app.js จับแทน ซึ่งข้อความจะไม่บอกสาเหตุจริงให้ผู้ใช้เห็น) ใช้ซ้ำได้ทั้ง user และ regulator route
const uploadProfileImageMiddleware = (req, res, next) => {
  uploadProfileImage.single("image")(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: `ไฟล์รูปภาพมีขนาดใหญ่เกินไป (ไม่เกิน ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB)`,
      });
    }
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || "ไม่สามารถอัปโหลดไฟล์ได้",
      });
    }
    next();
  });
};

module.exports = {
  uploadProfileImageMiddleware,
  UPLOAD_DIR,
  MAX_FILE_SIZE_BYTES,
};
