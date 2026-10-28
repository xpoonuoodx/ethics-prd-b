const express = require("express");
const adminControllers = require("../controllers/adminControllers");
const alumniControllers = require("../controllers/alumniControllers");
const { verifyToken, requireRole } = require("../middlewares/authMiddlewares");
const { uploadExcelMiddleware } = require("../utils/uploadMiddleware");
const router = express.Router();

// ทุก route ในไฟล์นี้ต้องเป็น role admin เท่านั้น
router.use(verifyToken, requireRole("admin"));

router.get("/dashboard", verifyToken, adminControllers.getDashboard);

// จัดการรุ่นของทำเนียบรุ่น (ชื่อรุ่น + ช่วงวันที่)
router.get("/alumni-batches", alumniControllers.getAdminBatches);
router.post("/alumni-batches", alumniControllers.createBatch);
router.put("/alumni-batches/:id", alumniControllers.updateBatch);
router.delete("/alumni-batches/:id", alumniControllers.deleteBatch);

// เพิ่มเส้นทางสำหรับดึงข้อมูลและเพิ่มข้อมูลหน่วยงาน
router.get("/get-organize", verifyToken, adminControllers.getOrganizations);
router.post("/add-organize", verifyToken, adminControllers.addOrganization);
router.put("/edit-organize/:id", verifyToken, adminControllers.editOrganize);
router.get("/get-regulators", verifyToken, adminControllers.getRegulators);
router.get("/get-users", verifyToken, adminControllers.getUsers);
router.delete("/delete-user/:id", verifyToken, adminControllers.deleteUser);
router.post("/add-user", verifyToken, adminControllers.addUser);

router.get("/view-user/:id", verifyToken, adminControllers.viewUser);
router.put("/edit-user/:id", verifyToken, adminControllers.editUser);
router.put("/change-user-role/:id", verifyToken, adminControllers.changeUserRole);

router.get(
  "/view-organize/:id",
  verifyToken,
  adminControllers.viewOrganization,
);

router.get(
  "/get-unassigned-regulators",
  verifyToken,
  adminControllers.getUnassignedRegulators,
);
router.post(
  "/assign-regulator-to-org/:id",
  verifyToken,
  adminControllers.assignRegulatorToOrganization,
);
router.post(
  "/remove-regulator-from-org/:id",
  verifyToken,
  adminControllers.removeRegulatorFromOrganization,
);

router.get("/get-principles", verifyToken, adminControllers.getPrinciples);
router.post("/add-principle", verifyToken, adminControllers.addPrinciple);
router.put(
  "/update-principle/:id",
  verifyToken,
  adminControllers.updatePrinciple,
);
router.delete(
  "/delete-principle/:id",
  verifyToken,
  adminControllers.deletePrinciple,
);

router.get(
  "/get-maturity-levels",
  verifyToken,
  adminControllers.getMaturityLevels,
);
router.put(
  "/update-maturity-level/:id",
  verifyToken,
  adminControllers.updateMaturityLevel,
);

router.get(
  "/get-impact-levels",
  verifyToken,
  adminControllers.getImpactLevels,
);
router.put(
  "/update-impact-level/:id",
  verifyToken,
  adminControllers.updateImpactLevel,
);

router.get("/get-components", verifyToken, adminControllers.getComponents);
router.post("/add-component", verifyToken, adminControllers.addComponent);
router.put(
  "/update-component/:id",
  verifyToken,
  adminControllers.updateComponent,
);
router.delete(
  "/delete-component/:id",
  verifyToken,
  adminControllers.deleteComponent,
);

// Activities ของแต่ละ Component (ตาม Maturity Level)
router.get(
  "/get-component-activities/:componentId",
  verifyToken,
  adminControllers.getComponentActivities,
);
router.post(
  "/add-component-activity",
  verifyToken,
  adminControllers.addComponentActivity,
);
router.put(
  "/update-component-activity/:id",
  verifyToken,
  adminControllers.updateComponentActivity,
);
router.delete(
  "/delete-component-activity/:id",
  verifyToken,
  adminControllers.deleteComponentActivity,
);

router.get(
  "/get-mapping-matrix",
  verifyToken,
  adminControllers.getMappingMatrix,
);
router.post(
  "/save-mapping-matrix",
  verifyToken,
  adminControllers.saveMappingMatrix,
);

router.get("/get-guideline", verifyToken, adminControllers.getGuideline);
router.post("/save-guideline", verifyToken, adminControllers.saveGuideline);
router.get(
  "/get-all-guidelines",
  verifyToken,
  adminControllers.getAllGuidelines,
);
router.delete(
  "/delete-guideline/:id",
  verifyToken,
  adminControllers.deleteGuideline,
);

router.get("/classroom", verifyToken, adminControllers.getChapters);
router.post("/classroom/add", verifyToken, adminControllers.createChapter);

router.delete(
  "/classroom/delete/:id",
  verifyToken,
  adminControllers.deleteChapter,
);

router.get("/classroom/:id", verifyToken, adminControllers.getChapterById);
router.put("/classroom/edit/:id", verifyToken, adminControllers.updateChapter);

router.get("/certificates", verifyToken, adminControllers.getCertificates);
router.delete(
  "/certificates/delete/:id",
  verifyToken,
  adminControllers.deleteCertificate,
);

router.get(
  "/certificate-settings/:groupId",
  verifyToken,
  adminControllers.getCertificateSettings,
);
router.post(
  "/certificate-settings",
  verifyToken,
  adminControllers.saveCertificateSettings,
);

router.delete(
  "/delete-organize/:id",
  verifyToken,
  adminControllers.deleteOrganization,
);

// ภาพรวมโครงการ - Admin ดูได้ทุกโครงการทุกหน่วยงาน (read-only)
router.get("/get-all-projects", verifyToken, adminControllers.getAllProjects);
router.get("/view-project/:id", verifyToken, adminControllers.viewProject);

// กิจกรรมล่าสุดในระบบ สำหรับหน้า Dashboard
router.get(
  "/recent-activity",
  verifyToken,
  adminControllers.getRecentActivity,
);

// หน้า "ตั้งค่าระบบ"
router.get("/settings", verifyToken, adminControllers.getSettings);
router.put("/settings", verifyToken, adminControllers.updateSettings);
router.put(
  "/change-password",
  verifyToken,
  adminControllers.changeOwnPassword,
);
router.get("/list-admins", verifyToken, adminControllers.getAdmins);
router.post("/add-admin", verifyToken, adminControllers.addAdmin);
router.put(
  "/toggle-admin/:id",
  verifyToken,
  adminControllers.toggleAdminStatus,
);

// จัดการวิดีโอ "อบรมออนไลน์ด้วยตัวเอง"
router.get(
  "/self-training",
  verifyToken,
  adminControllers.getSelfTrainingVideos,
);
router.post(
  "/self-training/add",
  verifyToken,
  adminControllers.createSelfTrainingVideo,
);
router.get(
  "/self-training/:id",
  verifyToken,
  adminControllers.getSelfTrainingVideoById,
);
router.put(
  "/self-training/edit/:id",
  verifyToken,
  adminControllers.updateSelfTrainingVideo,
);
router.delete(
  "/self-training/delete/:id",
  verifyToken,
  adminControllers.deleteSelfTrainingVideo,
);

// ส่งออกข้อมูลผู้ใช้งาน (เฉพาะ role = user) เป็นไฟล์ Excel
router.get(
  "/export-users-summary",
  verifyToken,
  adminControllers.getExportUsersSummary,
);
router.get(
  "/export-users-excel",
  verifyToken,
  adminControllers.exportUsersExcel,
);

// นำเข้าข้อมูลผู้ใช้งานจากไฟล์ Excel
router.get(
  "/import-users-template",
  verifyToken,
  adminControllers.downloadImportTemplate,
);
router.post(
  "/import-users",
  verifyToken,
  uploadExcelMiddleware,
  adminControllers.importUsers,
);
router.get(
  "/imported-users",
  verifyToken,
  adminControllers.getImportedUsers,
);
router.put(
  "/imported-users/:id/credentials",
  verifyToken,
  adminControllers.updateImportedUserCredentials,
);

module.exports = router;
