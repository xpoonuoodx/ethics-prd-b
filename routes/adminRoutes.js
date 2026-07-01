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

module.exports = router;
