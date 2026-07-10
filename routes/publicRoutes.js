const express = require("express");
const router = express.Router();
const publicControllers = require("../controllers/publicControllers");

router.get("/dashboard-stats", publicControllers.getDashboardStats);

module.exports = router;