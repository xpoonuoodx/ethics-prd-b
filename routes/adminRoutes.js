const express = require("express");
const adminControllers = require("../controllers/adminControllers");
const { verifyToken } = require("../middlewares/authMiddlewares");
const router = express.Router();

router.get("/dashboard", verifyToken, adminControllers.getDashboard);

// เพิ่มเส้นทางสำหรับดึงข้อมูลและเพิ่มข้อมูลหน่วยงาน
router.get("/get-organize", verifyToken, adminControllers.getOrganizations);
router.post("/add-organize", verifyToken, adminControllers.addOrganization);
router.get("/get-regulators", verifyToken, adminControllers.getRegulators);
router.get("/get-users", verifyToken, adminControllers.getUsers);
router.post("/add-user", verifyToken, adminControllers.addUser);

router.get(
  "/view-organize/:id",
  verifyToken,
  adminControllers.viewOrganization,
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

module.exports = router;
