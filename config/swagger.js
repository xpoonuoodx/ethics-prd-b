const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Ethic API Documentation",
      version: "1.0.0",
      description: "API for Ethic Web application",
    },
    servers: [
      {
        // แนะนำให้ใช้ URL แบบระบุชัดเจน หรือใช้ env
        url: `http://localhost:${process.env.MYAPP_PORT || 5007}`,
        description: "Development Server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          // ชื่อนี้ต้องตรงกับที่ใช้ใน security ด้านล่าง
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    // ปรับชื่อจาก BearerAuth เป็น bearerAuth ให้ตรงกับข้างบน
    security: [{ bearerAuth: [] }],
  },
  // ตรวจสอบ path ให้แน่ใจว่าโฟลเดอร์ชื่อ routes จริงๆ
  apis: ["./routes/*.js"],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = {
  swaggerUi,
  swaggerSpec,
};