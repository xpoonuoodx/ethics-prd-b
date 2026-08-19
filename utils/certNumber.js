const db = require("../db");

// prefix 3 ตัวอักษรตาม user_type - ใช้ร่วมกันระหว่าง userControllers.js กับ regulatorControllers.js
const USER_TYPE_PREFIX = {
  developer: "dev",
  researcher: "res",
  regulator: "reg",
  policy: "pol",
  "service provider": "ser",
  users: "usr",
};
const FALLBACK_PREFIX = "gen"; // สำหรับ user_type ที่เป็น NULL/ว่าง (เช่นบัญชีที่ admin สร้างให้เอง)

// สร้างเลขที่ใบประกาศรูปแบบ {prefix}-{ปี ค.ศ. 2 หลัก}{เลขรัน 5 หลัก} เช่น dev-2600001
// ใช้ UPSERT ใน cert_number_counters เพื่อให้การรันเลขเป็น atomic กันชนกันตอนออกพร้อมกันหลายคน
const generateCertNumber = async (userType) => {
  const prefix = USER_TYPE_PREFIX[userType] || FALLBACK_PREFIX;
  const year = String(new Date().getFullYear()).slice(-2);
  const prefixYear = `${prefix}${year}`;

  const result = await db.query(
    `INSERT INTO cert_number_counters (prefix_year, last_number)
     VALUES ($1, 1)
     ON CONFLICT (prefix_year)
     DO UPDATE SET last_number = cert_number_counters.last_number + 1
     RETURNING last_number`,
    [prefixYear],
  );
  const seq = result.rows[0].last_number;
  return `${prefix}-${year}${String(seq).padStart(5, "0")}`;
};

module.exports = { generateCertNumber, USER_TYPE_PREFIX, FALLBACK_PREFIX };
