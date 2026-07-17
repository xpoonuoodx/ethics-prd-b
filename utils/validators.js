// อนุญาตเฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข และ . _ - (ไม่มีภาษาไทย ไม่มีช่องว่าง)
const USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;

// อนุญาตเฉพาะอักขระภาษาอังกฤษที่พิมพ์ได้ (ตัวอักษร ตัวเลข สัญลักษณ์ เว้นวรรค) ไม่มีภาษาไทย
const PASSWORD_PATTERN = /^[\x20-\x7E]+$/;

const isValidUsername = (value) =>
  typeof value === "string" && USERNAME_PATTERN.test(value);

const isValidPassword = (value) =>
  typeof value === "string" && PASSWORD_PATTERN.test(value);

module.exports = { isValidUsername, isValidPassword };
