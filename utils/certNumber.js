const db = require("../db");
const { getTargetGroupFromUserType } = require("./targetGroup");

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

// prefix ตาม "หลักสูตร" (target_group) แทน user_type ของบัญชี - ใช้เฉพาะตอนออกใบเซอร์ข้ามหลักสูตร
// (เปิดโหมด "ทำแบบทดสอบข้ามหลักสูตร" แล้วสอบผ่านหลักสูตรที่ไม่ตรงกับ user_type ตัวเอง) เพราะตอนนั้น
// ไม่มี user_type เดียวที่สื่อความหมายของหลักสูตรนั้นได้ตรง ๆ (กลุ่ม 2 มีทั้ง developer/researcher/
// service provider ปนกัน) เลยต้องมี prefix ตายตัวสำรองไว้ต่อกลุ่มแทน
const TARGET_GROUP_PREFIX = {
  1: "reg", // regulator / policy
  2: "res", // developer / researcher / service provider
  3: "usr", // ทั่วไป
};

// สร้างเลขที่ใบประกาศรูปแบบ {prefix}-{ปี ค.ศ. 2 หลัก}{เลขรัน 5 หลัก} เช่น dev-2600001
// ใช้ UPSERT ใน cert_number_counters เพื่อให้การรันเลขเป็น atomic กันชนกันตอนออกพร้อมกันหลายคน
// targetGroup = หลักสูตรที่สอบผ่านจริง (course_group) ถ้าตรงกับกลุ่มของ user_type บัญชีเองอยู่แล้ว
// จะยังใช้ prefix เดิมตาม user_type เป๊ะ ๆ เหมือนก่อนหน้านี้ทุกกรณี (ไม่กระทบใบเซอร์ที่ออกแบบเดิม)
// จะ fallback ไปใช้ TARGET_GROUP_PREFIX ก็ต่อเมื่อสอบข้ามหลักสูตรจริง ๆ เท่านั้น
const generateCertNumber = async (userType, targetGroup) => {
  const ownPrefix = USER_TYPE_PREFIX[userType];
  const isOwnTrack =
    ownPrefix && getTargetGroupFromUserType(userType) === targetGroup;
  const prefix = isOwnTrack
    ? ownPrefix
    : TARGET_GROUP_PREFIX[targetGroup] || FALLBACK_PREFIX;
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

module.exports = {
  generateCertNumber,
  USER_TYPE_PREFIX,
  FALLBACK_PREFIX,
  TARGET_GROUP_PREFIX,
};
