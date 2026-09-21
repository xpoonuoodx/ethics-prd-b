const db = require("../db");

// ดึงค่าตั้งค่าระบบทั้งหมดจาก app_settings แถวเดียว (id = 1) มาไว้ที่จุดเดียว กันเขียน query
// ซ้ำหลายจุด (เดิม require_email_verification ถูก query ตรง ๆ อยู่ 2 ที่แล้ว) - เพิ่มคอลัมน์ใหม่
// ในอนาคตแก้ตรงนี้ที่เดียวพอ ไม่ต้องไล่แก้ทุก controller ที่เรียกใช้
const getAppSettings = async () => {
  const result = await db.query(
    "SELECT require_email_verification, allow_cross_track_testing FROM app_settings WHERE id = 1",
  );
  return (
    result.rows[0] || {
      require_email_verification: false,
      allow_cross_track_testing: false,
    }
  );
};

module.exports = { getAppSettings };
