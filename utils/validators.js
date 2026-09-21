// อนุญาตเฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข และ . _ - (ไม่มีภาษาไทย ไม่มีช่องว่าง)
const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;

// อนุญาตเฉพาะอักขระภาษาอังกฤษที่พิมพ์ได้ (ตัวอักษร ตัวเลข สัญลักษณ์ เว้นวรรค) ไม่มีภาษาไทย
const PASSWORD_PATTERN = /^[\x20-\x7E]+$/;

// เบอร์มือถือไทย: ตัวเลขล้วน 9-10 หลัก ขึ้นต้นด้วย 0 (เผื่อเบอร์บ้าน/เบอร์เก่าที่สั้นกว่ามือถือปกติ)
const PHONE_PATTERN = /^0\d{8,9}$/;

const isValidUsername = (value) =>
  typeof value === "string" && USERNAME_PATTERN.test(value);

const isValidPassword = (value) =>
  typeof value === "string" && PASSWORD_PATTERN.test(value);

const isValidPhone = (value) =>
  typeof value === "string" && PHONE_PATTERN.test(value);

module.exports = { isValidUsername, isValidPassword, isValidPhone };
