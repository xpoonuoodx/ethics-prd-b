const express = require("express");
const adminControllers = require("../controllers/adminControllers");
const { verifyToken, requireRole } = require("../middlewares/authMiddlewares");
const router = express.Router();

// ทุก route ในไฟล์นี้ต้องเป็น role admin เท่านั้น
router.use(verifyToken, requireRole("admin"));

router.get("/dashboard", verifyToken, adminControllers.getDashboard);

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

module.exports = router;
