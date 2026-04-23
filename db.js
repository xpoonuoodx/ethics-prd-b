// db.js
const { Pool, types } = require("pg"); // [UPDATE] นำเข้า types เพิ่มเติม
require("dotenv").config();
require("dotenv").config({ path: `.env.${process.env.NODE_ENV}` });

// [NEW] สั่งให้ไลบรารี pg ไม่ต้องแปลงวันที่เป็น Date Object
// รหัส 1114 คือ timestamp, 1184 คือ timestamptz, 1082 คือ date
// ให้ส่งค่ากลับมาเป็น String ดิบๆ เลย หน้าบ้านจะได้เอาไปโชว์ตรงๆ ไม่โดนบวก 7 ชม.
types.setTypeParser(1114, (stringValue) => stringValue);
types.setTypeParser(1184, (stringValue) => stringValue);
types.setTypeParser(1082, (stringValue) => stringValue);

if (!process.env.MYAPP_DATABASE_URL) {
  console.error("❌ Unknown DATABASE_URL in .env");
}

const pool = new Pool({
  connectionString: process.env.MYAPP_DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// บังคับให้ฐานข้อมูลใช้เวลาไทยทุกครั้งที่มีการเชื่อมต่อ
pool.on("connect", (client) => {
  client.query("SET TIME ZONE 'Asia/Bangkok'");
});

pool.connect((err, client, release) => {
  if (err) {
    return console.error("Neon connecting failed:", err.stack);
  }
  console.log("Neon PostgreSQL is Connected");
  release();
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
