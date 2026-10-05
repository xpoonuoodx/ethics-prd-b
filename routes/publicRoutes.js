const express = require("express");
const router = express.Router();
const publicControllers = require("../controllers/publicControllers");
const alumniControllers = require("../controllers/alumniControllers");
const { verifyCertLimiter } = require("../middlewares/rateLimitMiddlewares");

router.get("/dashboard-stats", publicControllers.getDashboardStats);
router.get("/proxy-image", publicControllers.proxyImage);
router.get("/alumni", alumniControllers.getPublicBatches);
router.get("/alumni/:id", alumniControllers.getPublicBatchAlumni);
router.get(
  "/verify-certificate/:certNumber",
  verifyCertLimiter,
  publicControllers.verifyCertificate,
);

module.exports = router;