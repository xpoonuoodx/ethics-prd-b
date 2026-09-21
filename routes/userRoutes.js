const express = require("express");
const router = express.Router();
const userControllers = require("../controllers/userControllers");
const { verifyToken } = require("../middlewares/authMiddlewares");
const { uploadProfileImageMiddleware } = require("../utils/uploadMiddleware");

router.get("/dashboard/:id", verifyToken, userControllers.getUserDashboard);
router.get("/classroom/:id", verifyToken, userControllers.getUserClassroom);
router.get("/chapter/:id", verifyToken, userControllers.getChapterById);

router.get("/tests/:id", verifyToken, userControllers.getUserTestsList);
router.get(
  "/test-questions/:chapterId",
  verifyToken,
  userControllers.getTestQuestions,
);
router.post("/test-submit", verifyToken, userControllers.submitTestResult);

// เส้นทางสำหรับเครื่องมือประเมิน
router.get("/tool-setup", verifyToken, userControllers.getToolSetupData);
router.post("/generate-tool", verifyToken, userControllers.generateToolResult);

router.get(
  "/tool-history-list/:id",
  verifyToken,
  userControllers.getUserToolsHistoryList,
); // เส้นทางใหม่ดึงลิสต์จริง
router.delete(
  "/tool-history-delete/:id",
  verifyToken,
  userControllers.deleteUserToolHistory,
); // เส้นทางใหม่สำหรับลบข้อมูล

router.get(
  "/certificates/:userId",
  verifyToken,
  userControllers.getUserCertificates,
);

router.get(
  "/component-activities/:componentId",
  verifyToken,
  userControllers.getComponentActivitiesList,
);

// เส้นทางหน้า "ข้อมูลส่วนตัว" ของตัวเอง
router.get("/profile", verifyToken, userControllers.getUserProfile);
router.put("/profile", verifyToken, userControllers.updateUserProfile);
router.post(
  "/profile-image",
  verifyToken,
  uploadProfileImageMiddleware,
  userControllers.uploadUserProfileImage,
);

module.exports = router;
