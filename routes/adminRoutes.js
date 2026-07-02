const express = require("express");
const adminControllers = require("../controllers/adminControllers");
const { verifyToken } = require("../middlewares/authMiddlewares");
const router = express.Router();

router.get("/dashboard", verifyToken, adminControllers.getDashboard);

// Route สำหรับระบบคลาสรูม
router.get("/classroom", verifyToken, adminControllers.getChapters);
router.post("/classroom/add", verifyToken, adminControllers.createChapter);

router.delete(
  "/classroom/delete/:id",
  verifyToken,
  adminControllers.deleteChapter,
);

// เพิ่มต่อท้าย route คลาสรูมที่มีอยู่เดิม
router.get("/classroom/:id", verifyToken, adminControllers.getChapterById);
router.put("/classroom/edit/:id", verifyToken, adminControllers.updateChapter);

module.exports = router;
