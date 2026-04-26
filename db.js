// db.js
const { Pool, types } = require("pg");
require("dotenv").config();
require("dotenv").config({ path: `.env.${process.env.NODE_ENV}` });

// สั่งให้ไลบรารี pg ไม่ต้องแปลงวันที่เป็น Date Object
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

// ทดสอบการเชื่อมต่อเมื่อเริ่มเซิร์ฟเวอร์
pool.connect((err, client, release) => {
  if (err) {
    return console.error("Neon connecting failed:", err.stack);
  }
  console.log("Neon PostgreSQL is Connected");
  release(); // คืน client กลับเข้า pool ทันทีเมื่อเทสต์เสร็จ
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};
