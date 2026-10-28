// ประเภทผู้ใช้งานที่ยอมรับได้ - ใช้ร่วมกันทั้งตอนสมัครสมาชิกเอง (authControllers) และตอนแอดมิน
// นำเข้าข้อมูลเป็นไฟล์ Excel (adminControllers) กันรายการตัวเลือกเพี้ยนไม่ตรงกันระหว่าง 2 ที่
const VALID_USER_TYPES = [
  "regulator",
  "policy",
  "researcher",
  "developer",
  "service provider",
  "users",
];

module.exports = { VALID_USER_TYPES };
