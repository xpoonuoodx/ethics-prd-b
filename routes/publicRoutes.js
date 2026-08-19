const express = require("express");
const router = express.Router();
const publicControllers = require("../controllers/publicControllers");

router.get("/dashboard-stats", publicControllers.getDashboardStats);
router.get("/proxy-image", publicControllers.proxyImage);
router.get(
  "/verify-certificate/:certNumber",
  publicControllers.verifyCertificate,
);

module.exports = router;