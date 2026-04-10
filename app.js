const express = require("express");
const cors = require("cors");
// const { swaggerUi, swaggerSpec } = require("./config/swagger");

// const authRoutes = require("./routes/authRoutes");
// const userRoutes = require("./routes/userRoutes");
// const adminRoutes = require("./routes/adminRoutes");
// const masterRoutes = require('./routes/masterRoutes');
// const homeRoutes = require('./routes/homeRoutes')

const app = express();

/**
 * @swagger
 * tags:
 * - name: Auth
 * description: ระบบยืนยันตัวตน (Login/Register)
 * - name: User
 * description: ระบบสำหรับเกษตรกร (Plots/Planting/Trading)
 * - name: Admin
 * description: ระบบสำหรับผู้ดูแล (Hotspot Analysis/Dashboard)
 */

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Swagger documentation
// app.use(
//   "/api-docs",
//   swaggerUi.serve,
//   swaggerUi.setup(swaggerSpec, { explorer: true }),
// );

// Routes
// app.use('/', homeRoutes);
// app.use("/auth", authRoutes);
// app.use("/user", userRoutes);
// app.use("/admin", adminRoutes);
// app.use('/master', masterRoutes);

module.exports = app;
