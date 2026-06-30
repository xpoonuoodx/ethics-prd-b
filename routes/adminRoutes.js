const express = require("express");
const adminControllers = require("../controllers/adminControllers");
const { verifyToken } = require("../middlewares/authMiddlewares");
const router = express.Router();

router.get("/dashboard", verifyToken, adminControllers.getDashboard);

module.exports = router;
