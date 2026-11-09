const rateLimit = require("express-rate-limit");
const db = require("../db");

// นิยาม rate limit ทุกตัวในระบบไว้ที่เดียว (ตัวไหนเพิ่มในอนาคตให้มาเพิ่มในนี้ แล้วเพิ่มแถวใน
// migration ตาม key ด้วย) ค่า max ยังคง hardcode ไว้เหมือนเดิม ส่วนที่แอดมินปรับได้จากหน้า
// "ตั้งค่าระบบ" มีแค่ enabled (เปิด/ปิด) กับ windowMinutes (กี่นาที/รอบ)
const LIMITER_DEFS = {
  login: {
    label: "เข้าสู่ระบบ (Login)",
    max: 10,
    defaultWindowMinutes: 15,
    skipSuccessfulRequests: true,
    buildMessage: (minutes) => ({
      message: `พยายามเข้าสู่ระบบบ่อยเกินไป กรุณาลองใหม่อีกครั้งใน ${minutes} นาที`,
    }),
  },
  register: {
    label: "สมัครสมาชิก (Register)",
    max: 10,
    defaultWindowMinutes: 60,
    buildMessage: () => ({
      message: "สมัครสมาชิกบ่อยเกินไป กรุณาลองใหม่อีกครั้งภายหลัง",
    }),
  },
  forgotPassword: {
    label: "ขอลิงก์รีเซ็ตรหัสผ่าน (Forgot Password)",
    max: 5,
    defaultWindowMinutes: 60,
    buildMessage: () => ({
      message: "ขอลิงก์รีเซ็ตรหัสผ่านบ่อยเกินไป กรุณาลองใหม่อีกครั้งภายหลัง",
    }),
  },
  resetPassword: {
    label: "ตั้งรหัสผ่านใหม่ (Reset Password)",
    max: 10,
    defaultWindowMinutes: 60,
    buildMessage: () => ({
      message: "ทำรายการบ่อยเกินไป กรุณาลองใหม่อีกครั้งภายหลัง",
    }),
  },
  verifyCert: {
    label: "ตรวจสอบใบประกาศนียบัตร (Verify Certificate)",
    max: 20,
    defaultWindowMinutes: 15,
    buildMessage: () => ({
      success: false,
      message: "ตรวจสอบใบประกาศบ่อยเกินไป กรุณาลองใหม่อีกครั้งภายหลัง",
    }),
  },
  lineAuth: {
    label: "เข้าสู่ระบบ/สมัครผ่าน LINE",
    max: 30,
    defaultWindowMinutes: 15,
    buildMessage: () => ({
      message: "ทำรายการผ่าน LINE บ่อยเกินไป กรุณาลองใหม่อีกครั้งภายหลัง",
    }),
  },
  visit: {
    label: "นับจำนวนการเข้าชม (Visit Counter)",
    max: 20,
    defaultWindowMinutes: 60,
    buildMessage: () => ({ message: "ส่งข้อมูลบ่อยเกินไป" }),
  },
};

const LIMITER_KEYS = Object.keys(LIMITER_DEFS);

// ค่าตั้งค่าปัจจุบัน (enabled, windowMinutes) เก็บไว้ใน memory กันไม่ต้อง query DB ทุก request
// เริ่มต้นด้วยค่า default ของโค้ด (เปิดใช้งานหมด) ก่อน แล้วค่อยโหลดค่าจริงจาก DB มาทับทีหลัง
// (ดู initRateLimitSettings) เผื่อ DB ยังโหลดไม่เสร็จตอน request แรกๆเข้ามา จะได้ไม่ error
const state = {};
const instances = {};

LIMITER_KEYS.forEach((key) => {
  state[key] = { enabled: true, windowMinutes: LIMITER_DEFS[key].defaultWindowMinutes };
});

const buildInstance = (key) => {
  const def = LIMITER_DEFS[key];
  const s = state[key];
  instances[key] = rateLimit({
    windowMs: s.windowMinutes * 60 * 1000,
    limit: def.max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: def.skipSuccessfulRequests || false,
    skip: () => !s.enabled,
    message: def.buildMessage(s.windowMinutes),
  });
};

LIMITER_KEYS.forEach(buildInstance);

// wrapper ที่ identity ไม่เปลี่ยน (route ไฟล์อื่น require ไปใช้ตรงๆได้เลย) ส่วน instance จริง
// ของ express-rate-limit ด้านในสลับได้ทุกครั้งที่แอดมินบันทึกค่าใหม่ โดยไม่ต้อง restart server
const wrap = (key) => (req, res, next) => instances[key](req, res, next);

// โหลดค่าตั้งค่าจริงจาก DB มาทับค่า default ตอนเซิร์ฟเวอร์เริ่ม (เรียกครั้งเดียวตอน require ไฟล์นี้)
const initRateLimitSettings = async () => {
  try {
    const result = await db.query(
      "SELECT limiter_key, enabled, window_minutes FROM rate_limit_settings",
    );
    result.rows.forEach((row) => {
      if (!LIMITER_DEFS[row.limiter_key]) return;
      state[row.limiter_key] = {
        enabled: row.enabled,
        windowMinutes: row.window_minutes,
      };
      buildInstance(row.limiter_key);
    });
  } catch (error) {
    console.error(
      "⚠️  โหลดค่าตั้งค่า rate limit จาก DB ไม่สำเร็จ ใช้ค่า default ของโค้ดไปก่อน:",
      error.message,
    );
  }
};

initRateLimitSettings();

// เรียกจาก adminControllers หลังอัปเดตแถวใน DB แล้ว เพื่อให้มีผลทันทีโดยไม่ต้อง restart server
const applyRateLimitSetting = (key, { enabled, windowMinutes }) => {
  if (!LIMITER_DEFS[key]) return;
  state[key] = { enabled, windowMinutes };
  buildInstance(key);
};

const getRateLimitSettingsList = () =>
  LIMITER_KEYS.map((key) => ({
    key,
    label: LIMITER_DEFS[key].label,
    max: LIMITER_DEFS[key].max,
    enabled: state[key].enabled,
    windowMinutes: state[key].windowMinutes,
  }));

module.exports = {
  visitLimiter: wrap("visit"),
  loginLimiter: wrap("login"),
  registerLimiter: wrap("register"),
  forgotPasswordLimiter: wrap("forgotPassword"),
  resetPasswordLimiter: wrap("resetPassword"),
  verifyCertLimiter: wrap("verifyCert"),
  lineAuthLimiter: wrap("lineAuth"),
  LIMITER_KEYS,
  getRateLimitSettingsList,
  applyRateLimitSetting,
};
