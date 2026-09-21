// แปลง user_type ของผู้ใช้ เป็นกลุ่มหลักสูตร (target_group) 1/2/3 ที่ผูกกับตาราง chapters
// ใช้ร่วมกันทั้ง userControllers.js และ regulatorControllers.js กันโค้ดซ้ำ (เดิมแต่ละไฟล์
// เขียน if/else ชุดนี้แยกกันหลายจุด)
const getTargetGroupFromUserType = (userType) => {
  const typeStr = (userType || "").toLowerCase();
  if (typeStr.includes("regulator") || typeStr.includes("policy")) return 1;
  if (
    typeStr.includes("provider") ||
    typeStr.includes("developer") ||
    typeStr.includes("researcher")
  ) {
    return 2;
  }
  return 3;
};

module.exports = { getTargetGroupFromUserType };
