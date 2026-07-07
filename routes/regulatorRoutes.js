const express = require("express");
const router = express.Router();
const regulatorControllers = require("../controllers/regulatorControllers");
const { verifyToken } = require("../middlewares/authMiddlewares"); // ปรับ path ให้ตรงกับ middleware ของคุณ

// เส้นทางสำหรับดึงข้อมูล Dashboard ของ Regulator
router.get("/dashboard", verifyToken, regulatorControllers.getDashboard);
router.get("/get-users", verifyToken, regulatorControllers.getUsers);
router.post("/add-user", verifyToken, regulatorControllers.addUser);
router.delete("/delete-user/:id", verifyToken, regulatorControllers.deleteUser);
router.get("/view-user/:id", verifyToken, regulatorControllers.viewUser);
router.put("/edit-user/:id", verifyToken, regulatorControllers.editUser);

router.get("/get-projects", verifyToken, regulatorControllers.getProjects);
router.post("/add-project", verifyToken, regulatorControllers.addProject);
router.delete(
  "/delete-project/:id",
  verifyToken,
  regulatorControllers.deleteProject,
);

// เส้นทางเพิ่มคนเข้าโครงการ
router.post(
  "/assign-user",
  verifyToken,
  regulatorControllers.assignUserToProject,
);

router.get("/view-project/:id", verifyToken, regulatorControllers.viewProject);

module.exports = router;
