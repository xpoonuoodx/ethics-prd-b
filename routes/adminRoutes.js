const express = require("express");
const adminControllers = require("../controllers/adminControllers");
const { verifyToken } = require("../middlewares/authMiddlewares");
const router = express.Router();

router.get("/dashboard", verifyToken, adminControllers.getDashboard);

// Route สำหรับระบบคลาสรูม
router.get("/classroom", verifyToken, adminControllers.getChapters);
router.post("/classroom/add", verifyToken, adminControllers.createChapter);

module.exports = router;
