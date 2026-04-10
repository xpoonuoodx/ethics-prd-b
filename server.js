process.env.TZ = 'Asia/Bangkok';

const dotenv = require("dotenv");
const app = require("./app");
const swaggerUi = require("swagger-ui-express");


require("dotenv").config({ path: `.env` });
require("dotenv").config({ path: `.env.${process.env.NODE_ENV}` });

const PORT = process.env.MYAPP_PORT;

console.log("PORT:", process.env.MYAPP_PORT);

// Swagger setup version 1
// const swaggerOptions = {
//   definition: {
//     openapi: "3.0.0",
//     info: {
//       title: "GAP API Documentation",
//       version: "1.0.0",
//       description: "GAP backend API documentation",
//     },
//     servers: [
//       {
//         url: `http://localhost:${PORT}`,
//       },
//     ],
//     components: {
//       securitySchemes: {
//         bearerAuth: {
//           type: "http",
//           scheme: "bearer",
//           bearerFormat: "JWT",
//         },
//       },
//     },
//     security: [{ BearerAuth: [] }],
//   },
//   apis: ["./routes/*.js"],
// };

// const swaggerSpec = swaggerJsdoc(swaggerOptions);

// ใช้งาน Swagger
// app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));


const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

server.timeout = 600000;

server.headersTimeout = 601000;
server.keepAliveTimeout = 600000;
