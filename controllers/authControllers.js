const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("../db"); // เชื่อมต่อกับ Neon (pg pool)
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const {
  isValidUsername,
  isValidPassword,
  isValidPhone,
} = require("../utils/validators");
const {
  getLineAuthorizeUrl,
  exchangeCodeForToken,
  verifyIdToken,
} = require("../utils/lineAuth");
const { getAppSettings } = require("../utils/appSettings");

// เอา origin แรกจากรายการ MYAPP_FRONTEND_URL (คั่นด้วยจุลภาคได้หลายค่าตอน dev เช่น
// "http://localhost:5173,http://localhost:5174,...") มาใช้ตอน redirect กลับเข้าหน้าเว็บ
// เพราะ redirect ไปได้แค่ URL เดียวเท่านั้น - ตอน production ปกติมีแค่ค่าเดียวอยู่แล้วไม่กระทบ
const getFrontendUrl = () =>
  (process.env.MYAPP_FRONTEND_URL || "").split(",")[0].trim();

// --- ตั้งค่า OAuth2 สำหรับ Gmail ---
const oAuth2Client = new google.auth.OAuth2(
  process.env.MYAPP_CLIENT_ID,
  process.env.MYAPP_CLIENT_SECRET,
  process.env.MYAPP_REDIRECT_URI,
);
oAuth2Client.setCredentials({ refresh_token: process.env.MYAPP_REFRESH_TOKEN });

/**
 * ฟังก์ชันหลักสำหรับส่งอีเมลผ่าน OAuth2
 */
// สร้าง HTML อีเมลยืนยันตัวตน ใช้ร่วมกันระหว่างสมัครแบบปกติ (register) กับสมัครผ่าน LINE
// (completeLineRegister) เพราะทั้งคู่ต้องส่งอีเมลยืนยันแบบเดียวกันทุกอย่าง
function buildVerificationEmailHtml(userCode, verificationUrl) {
  return `
      <div style="font-family: 'Kanit', sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 15px; max-width: 600px;">
        <h2 style="color: #2d6a4f; text-align: center;">ยินดีต้อนรับสู่ระบบ Ethic AI System</h2>
        <p>คุณได้ทำการลงทะเบียนสำเร็จแล้ว รหัสผู้ใช้งานของคุณคือ <b>${userCode}</b></p>
        <p>เพื่อความปลอดภัยและเปิดใช้งานบัญชีของคุณ กรุณาคลิกปุ่มด้านล่าง:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}" style="background-color: #56ab2f; color: white; padding: 14px 30px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 16px;">ยืนยันตัวตนทันที</a>
        </div>
        <p style="color: #7f8c8d; font-size: 13px;">หากคุณไม่ได้ทำการสมัครสมาชิก กรุณาเพิกเฉยต่ออีเมลฉบับนี้</p>
        <hr style="border: 0; border-top: 1px solid #eee;">
        <p style="text-align: center; font-size: 12px; color: #bdc3c7;">© 2026 Ethic AI System</p>
      </div>
    `;
}

async function sendMail(email, subject, html) {
  try {
    const accessToken = await oAuth2Client.getAccessToken();

    const transport = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: process.env.MYAPP_GOOGLE_EMAIL,
        clientId: process.env.MYAPP_CLIENT_ID,
        clientSecret: process.env.MYAPP_CLIENT_SECRET,
        refreshToken: process.env.MYAPP_REFRESH_TOKEN,
        accessToken: accessToken.token,
      },
    });

    const mailOptions = {
      from: `"Ethic System" <${process.env.MYAPP_GOOGLE_EMAIL}>`,
      to: email,
      subject: subject,
      html: html,
    };

    return await transport.sendMail(mailOptions);
  } catch (error) {
    console.error("Error sending email via OAuth2:", error);
    throw error;
  }
}

// --- 1. LOGIN ---
exports.login = async (req, res) => {
  const { username, password } = req.body;

  try {
    // JOIN ข้อมูลจากตาราง users และ profiles
    const result = await db.query(
      `SELECT u.id, u.username, u.password, u.role, u.user_type, u.is_active,
              p.is_verified, p.first_name_th, p.last_name_th, p.user_code, p.profile_image_url
       FROM users u
       JOIN profiles p ON u.id = p.user_id
       WHERE u.username = $1`,
      [username],
    );

    if (result.rows.length === 0) {
      return res
        .status(401)
        .json({ message: "ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง" });
    }

    const user = result.rows[0];

    // เช็คว่าบัญชีนี้ถูกแอดมินปิดการใช้งานไว้หรือไม่ (ตั้งค่าได้ที่หน้า Admin > ตั้งค่าระบบ)
    if (user.is_active === false) {
      return res.status(403).json({
        message: "บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ",
      });
    }

    // ตรวจสอบสถานะการยืนยันอีเมล เฉพาะตอนระบบเปิดบังคับไว้เท่านั้น (ตั้งค่าได้ที่หน้า
    // Admin > ตั้งค่าระบบ - เดิมปิดถาวรในโค้ดสำหรับรอบอบรม ตอนนี้ให้แอดมินสลับเองได้)
    const settingsResult = await db.query(
      "SELECT require_email_verification FROM app_settings WHERE id = 1",
    );
    const requireVerification =
      settingsResult.rows[0]?.require_email_verification || false;
    if (requireVerification && !user.is_verified) {
      return res.status(403).json({
        message: "บัญชีของคุณยังไม่ได้ยืนยันตัวตน กรุณาตรวจสอบอีเมลของคุณ",
      });
    }

    // ตรวจสอบรหัสผ่าน
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ message: "ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง" });
    }

    // สร้าง Token
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.MYAPP_JWT_SECRET,
      { expiresIn: "1d" },
    );

    res.json({
      token,
      user: {
        id: user.id,
        user_code: user.user_code,
        username: user.username,
        name: `${user.first_name_th} ${user.last_name_th}`,
        role: user.role,
        user_type: user.user_type,
        profile_image_url: user.profile_image_url,
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล" });
  }
};

// --- 2. REGISTER ---
const VALID_USER_TYPES = [
  "regulator",
  "policy",
  "researcher",
  "developer",
  "service provider",
  "users",
];

// กลุ่มอุตสาหกรรมของหน่วยงาน (เฉพาะสมัครในฐานะหน่วยงาน)
const VALID_SECTORS = [
  "government",
  "finance",
  "healthcare",
  "education",
  "industry",
  "commerce",
  "other",
];

exports.register = async (req, res) => {
  const {
    account_type, // "organization" | "individual"
    first_name,
    last_name,
    email,
    phone,
    username,
    password,
    user_type,
    org_name,
    sector,
  } = req.body;

  const isOrganization = account_type === "organization";

  if (!isValidUsername(username)) {
    return res.status(400).json({
      message: "ชื่อผู้ใช้งานต้องเป็นภาษาอังกฤษ ตัวเลข หรือ . _ - เท่านั้น (ห้ามใช้ภาษาไทย)",
    });
  }
  if (!isValidPassword(password)) {
    return res
      .status(400)
      .json({ message: "รหัสผ่านต้องเป็นภาษาอังกฤษเท่านั้น (ห้ามใช้ภาษาไทย)" });
  }
  if (!isValidPhone(phone)) {
    return res.status(400).json({
      message: "กรุณาระบุเบอร์โทรศัพท์ให้ถูกต้อง (ตัวเลข 9-10 หลัก ขึ้นต้นด้วย 0)",
    });
  }
  if (!VALID_USER_TYPES.includes(user_type)) {
    return res.status(400).json({ message: "กรุณาเลือกประเภทผู้ใช้งานให้ถูกต้อง" });
  }
  if (isOrganization && (!org_name || org_name.trim() === "")) {
    return res.status(400).json({ message: "กรุณาระบุชื่อหน่วยงาน" });
  }
  if (isOrganization && !VALID_SECTORS.includes(sector)) {
    return res.status(400).json({ message: "กรุณาเลือกกลุ่มอุตสาหกรรม (Sector) ให้ถูกต้อง" });
  }

  const client = await db.getClient(); // ใช้ client เพื่อทำ Transaction

  try {
    await client.query("BEGIN"); // เริ่ม Transaction

    // ตรวจสอบ Username ซ้ำในตาราง users
    const checkUsername = await client.query(
      "SELECT username FROM users WHERE username = $1",
      [username],
    );
    if (checkUsername.rows.length > 0) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "ชื่อผู้ใช้งาน (Username) นี้ถูกใช้งานแล้ว" });
    }

    // ตรวจสอบ Email ซ้ำในตาราง profiles
    const checkProfile = await client.query(
      "SELECT email FROM profiles WHERE email = $1",
      [email],
    );
    if (checkProfile.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "อีเมลนี้ถูกใช้งานแล้ว" });
    }

    // สมัครในฐานะหน่วยงาน: สร้างหน่วยงานใหม่ก่อน แล้วผูก user เป็น role = regulator
    let organizationId = null;
    if (isOrganization) {
      const date = new Date();
      const yy = String(date.getFullYear()).slice(-2);
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const orgCode = `ORG-${yy}${mm}-${crypto.randomBytes(3).toString("hex")}`;

      const insertOrg = await client.query(
        `INSERT INTO organizations (org_code, org_name, status, sector) VALUES ($1, $2, 'Active', $3) RETURNING id`,
        [orgCode, org_name.trim(), sector],
      );
      organizationId = insertOrg.rows[0].id;
    }

    const finalRole = isOrganization ? "regulator" : "user";
    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = crypto.randomBytes(32).toString("hex");

    // 1. บันทึกลงตาราง users และดึง id กลับมา
    const userInsertResult = await client.query(
      `INSERT INTO users (username, password, role, organization_id, user_type)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [username, hashedPassword, finalRole, organizationId, user_type],
    );
    const newUserId = userInsertResult.rows[0].id;

    // --- สร้าง Format ID (เช่น USR-2604-00001) ---
    const date = new Date();
    const yy = String(date.getFullYear()).slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const paddedId = String(newUserId).padStart(5, "0");
    const userCode = `USR-${yy}${mm}-${paddedId}`;

    // 2. บันทึกลงตาราง profiles
    await client.query(
      `INSERT INTO profiles
       (user_id, user_code, first_name_th, last_name_th, email, mobile, verification_token, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        newUserId,
        userCode,
        first_name,
        last_name,
        email,
        phone,
        verificationToken,
        false,
      ],
    );

    await client.query("COMMIT"); // ยืนยันการบันทึกข้อมูลทั้งสองตาราง

    // ส่งอีเมลยืนยันเฉพาะตอนระบบเปิดบังคับยืนยันอีเมลไว้เท่านั้น (ตั้งค่าได้ที่หน้า Admin >
    // ตั้งค่าระบบ) - ถ้าปิดอยู่ก็ไม่มีประโยชน์จะส่ง เพราะ login เข้าได้เลยโดยไม่ต้องกดยืนยันอยู่แล้ว
    // สำคัญมากตอนมีรอบสมัครพร้อมกันจำนวนมาก (เช่นหลักพันคน) กันส่งอีเมลจริงโดยไม่จำเป็น
    // เปลืองค่าใช้จ่าย/โดน rate limit ของผู้ให้บริการอีเมลโดยเปล่าประโยชน์
    const { require_email_verification } = await getAppSettings();

    if (require_email_verification) {
      const verificationUrl = `${process.env.MYAPP_BACKEND_URL}/auth/verify-email?token=${verificationToken}`;
      const html = buildVerificationEmailHtml(userCode, verificationUrl);
      try {
        await sendMail(email, "ยืนยันการลงทะเบียนระบบ Ethic AI System", html);
      } catch (mailError) {
        console.error("Mail Delivery Failed:", mailError);
      }
    }

    res.status(201).json({
      message: require_email_verification
        ? "ลงทะเบียนสำเร็จ กรุณาตรวจสอบอีเมลเพื่อยืนยันตัวตน"
        : "ลงทะเบียนสำเร็จ",
    });
  } catch (error) {
    await client.query("ROLLBACK"); // หากพังกลางคัน ให้ยกเลิกการบันทึกทั้งหมด
    console.error("Register Error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการลงทะเบียน" });
  } finally {
    client.release(); // คืน Connection กลับสู่ Pool
  }
};

// --- 3. VERIFY EMAIL ---
exports.verifyEmail = async (req, res) => {
  const { token } = req.query;
  try {
    const result = await db.query(
      "SELECT id FROM profiles WHERE verification_token = $1",
      [token],
    );

    if (result.rows.length === 0) {
      return res.redirect(
        `${process.env.MYAPP_FRONTEND_URL}/login?error=invalid_token`,
      );
    }

    // อัปเดตเฉพาะตาราง profiles
    await db.query(
      "UPDATE profiles SET is_verified = true, verification_token = NULL WHERE id = $1",
      [result.rows[0].id],
    );

    res.redirect(`${process.env.MYAPP_FRONTEND_URL}/login?status=verified`);
  } catch (error) {
    console.error("Verification Error:", error);
    res.redirect(`${process.env.MYAPP_FRONTEND_URL}/login?error=server_error`);
  }
};

// --- FORGOT PASSWORD (ส่งอีเมล) ---
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  // ข้อความตอบกลับแบบเดียวกันเสมอ ไม่ว่าอีเมลนี้จะมีอยู่ในระบบหรือไม่
  // กันไม่ให้ใช้ endpoint นี้ไล่เช็คว่าอีเมลไหนสมัครไว้บ้าง (user enumeration)
  const genericResponse = {
    message: "หากอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้แล้ว",
  };

  try {
    const result = await db.query("SELECT id FROM profiles WHERE email = $1", [
      email,
    ]);
    if (result.rows.length === 0) {
      return res.json(genericResponse);
    }

    const resetToken = crypto.randomBytes(32).toString("hex");

    // บันทึก Token ลงตาราง profiles พร้อมวันหมดอายุ 1 ชั่วโมง กันลิงก์เก่าถูกนำไปใช้ซ้ำภายหลัง
    await db.query(
      `UPDATE profiles
       SET reset_token = $1, reset_token_expires_at = NOW() + INTERVAL '1 hour'
       WHERE email = $2`,
      [resetToken, email],
    );

    const resetUrl = `${process.env.MYAPP_FRONTEND_URL}/reset-password?token=${resetToken}`;
    const html = `
      <div style="font-family: 'Kanit', sans-serif; padding: 20px;">
        <h2>แจ้งลืมรหัสผ่าน</h2>
        <p>คุณได้ทำการขอเปลี่ยนรหัสผ่านใหม่ กรุณาคลิกปุ่มด้านล่าง (ลิงก์นี้จะหมดอายุใน 1 ชั่วโมง):</p>
        <a href="${resetUrl}" style="background: #2d6a4f; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">ตั้งรหัสผ่านใหม่</a>
        <p>หากคุณไม่ได้เป็นคนขอ กรุณาเพิกเฉยต่ออีเมลฉบับนี้</p>
      </div>
    `;

    await sendMail(email, "เปลี่ยนรหัสผ่านใหม่ - Ethic AI", html);
    res.json(genericResponse);
  } catch (error) {
    console.error("Forgot Password Error:", error);
    // ตอบข้อความเดิมแม้เกิดข้อผิดพลาดฝั่งเรา เพื่อไม่เปิดเผยสถานะภายในให้ผู้ไม่หวังดี
    res.json(genericResponse);
  }
};

// --- RESET PASSWORD (เปลี่ยนรหัสผ่านจริง) ---
exports.resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;

  const client = await db.getClient(); // ใช้ client เดียวกันตลอด transaction

  try {
    await client.query("BEGIN");

    // หา user_id จากตาราง profiles ด้วย token พร้อมเช็คว่ายังไม่หมดอายุ
    const result = await client.query(
      `SELECT user_id FROM profiles
       WHERE reset_token = $1 AND reset_token_expires_at > NOW()`,
      [token],
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Token ไม่ถูกต้องหรือหมดอายุ" });
    }

    const userId = result.rows[0].user_id;
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 1. อัปเดตรหัสผ่านใหม่ในตาราง users
    await client.query("UPDATE users SET password = $1 WHERE id = $2", [
      hashedPassword,
      userId,
    ]);

    // 2. เคลียร์ reset_token ในตาราง profiles กันนำ token เดิมกลับมาใช้ซ้ำ
    await client.query(
      `UPDATE profiles
       SET reset_token = NULL, reset_token_expires_at = NULL
       WHERE reset_token = $1`,
      [token],
    );

    await client.query("COMMIT");

    res.json({ message: "เปลี่ยนรหัสผ่านสำเร็จ" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Reset Password Error:", error);
    res.status(500).json({ message: "ไม่สามารถเปลี่ยนรหัสผ่านได้" });
  } finally {
    client.release();
  }
};

// --- ดึงข้อมูลบัญชีของตัวเอง (ใช้ตอน login ผ่าน LINE เพราะ backend redirect กลับมาได้แค่ token
// เฉย ๆ ผ่าน URL ไม่สะดวกจะแนบข้อมูลผู้ใช้ทั้งก้อนไปด้วย - หน้าเว็บเลยเรียก endpoint นี้แยกอีกที
// เพื่อได้ข้อมูล user object แบบเดียวกับตอน login ปกติมาเก็บใน localStorage) ใช้ได้ทุก role
exports.getMe = async (req, res) => {
  try {
    const userId = req.user.account_id || req.user.id;
    const result = await db.query(
      `SELECT u.id, u.username, u.role, u.user_type,
              p.first_name_th, p.last_name_th, p.user_code, p.profile_image_url
       FROM users u
       JOIN profiles p ON u.id = p.user_id
       WHERE u.id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้งาน" });
    }

    const u = result.rows[0];
    res.json({
      user: {
        id: u.id,
        user_code: u.user_code,
        username: u.username,
        name: `${u.first_name_th} ${u.last_name_th}`,
        role: u.role,
        user_type: u.user_type,
        profile_image_url: u.profile_image_url,
      },
    });
  } catch (error) {
    console.error("Get Me Error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลผู้ใช้งาน" });
  }
};

// ==========================================
// LINE Login - เข้าสู่ระบบ/สมัครสมาชิกผ่าน LINE
// ==========================================

// 1. พาไปหน้า "อนุญาต" ของ LINE
exports.lineLogin = (req, res) => {
  // state เซ็นชื่อด้วย JWT อายุสั้น ๆ ใช้ตรวจตอน callback กลับมาว่าเป็น request ที่เราเริ่มเอง
  // จริง ๆ (กัน CSRF) ไม่ต้องพึ่ง session/cookie เพิ่ม เพราะระบบนี้ไม่มี session store อยู่แล้ว
  const state = jwt.sign(
    { purpose: "line_oauth" },
    process.env.MYAPP_JWT_SECRET,
    { expiresIn: "10m" },
  );
  res.redirect(getLineAuthorizeUrl(state));
};

// 2. LINE redirect กลับมาที่นี่พร้อม code (หรือ error ถ้าผู้ใช้กดยกเลิก)
exports.lineCallback = async (req, res) => {
  const frontendUrl = getFrontendUrl();
  const { code, state, error: lineError } = req.query;

  if (lineError) {
    return res.redirect(`${frontendUrl}/login?error=line_cancelled`);
  }
  if (!code || !state) {
    return res.redirect(`${frontendUrl}/login?error=line_invalid`);
  }

  try {
    jwt.verify(state, process.env.MYAPP_JWT_SECRET);
  } catch {
    return res.redirect(`${frontendUrl}/login?error=line_invalid`);
  }

  try {
    const tokenResult = await exchangeCodeForToken(code);
    const profile = await verifyIdToken(tokenResult.id_token);
    const lineUserId = profile.sub;

    if (!lineUserId) {
      return res.redirect(`${frontendUrl}/login?error=line_server_error`);
    }

    // เคยผูกบัญชีนี้กับ LINE ไว้แล้ว -> login เข้าระบบให้ทันที ไม่ต้องกรอกอะไรซ้ำ
    const existing = await db.query(
      "SELECT id, role, is_active FROM users WHERE line_user_id = $1",
      [lineUserId],
    );

    if (existing.rows.length > 0) {
      const user = existing.rows[0];
      if (user.is_active === false) {
        return res.redirect(`${frontendUrl}/login?error=account_disabled`);
      }
      const token = jwt.sign(
        { id: user.id, role: user.role },
        process.env.MYAPP_JWT_SECRET,
        { expiresIn: "1d" },
      );
      return res.redirect(`${frontendUrl}/line-callback?token=${token}`);
    }

    // ยังไม่เคยสมัคร - พักข้อมูลโปรไฟล์ LINE ไว้ชั่วคราว รอผู้ใช้กรอกฟอร์ม "ยืนยันข้อมูล" ให้ครบ
    // ก่อนถึงจะสร้างบัญชีจริง (บังคับกรอกนามสกุล/เบอร์โทร/อีเมล เพราะ LINE ให้แค่ชื่อ display
    // กับรูปเท่านั้น ไม่มีเบอร์โทร และอีเมลก็ให้เฉพาะถ้า channel ได้รับอนุมัติ permission แล้ว)
    const pendingId = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await db.query(
      `INSERT INTO line_pending_signups (id, line_user_id, display_name, picture_url, email, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        pendingId,
        lineUserId,
        profile.name || "",
        profile.picture || null,
        profile.email || null,
        expiresAt,
      ],
    );

    res.redirect(`${frontendUrl}/register?line_pending=${pendingId}`);
  } catch (error) {
    console.error("LINE Callback Error:", error);
    res.redirect(`${frontendUrl}/login?error=line_server_error`);
  }
};

// 3. หน้าฟอร์ม "ยืนยันข้อมูลก่อนสมัคร" เรียกอันนี้มาโหลดข้อมูลที่ดึงจาก LINE ไว้มา prefill
exports.getLinePendingSignup = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT display_name, picture_url, email
       FROM line_pending_signups
       WHERE id = $1 AND expires_at > CURRENT_TIMESTAMP`,
      [id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "ลิงก์หมดอายุหรือไม่ถูกต้อง กรุณาเริ่มสมัครผ่าน LINE ใหม่อีกครั้ง",
      });
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error("Get LINE Pending Signup Error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// 4. ผู้ใช้กรอกฟอร์มยืนยันข้อมูลครบแล้ว กดยืนยัน -> สร้างบัญชีจริงตอนนี้
exports.completeLineRegister = async (req, res) => {
  const { pending_id, first_name, last_name, email, phone, user_type } =
    req.body;

  if (!first_name || !first_name.trim() || !last_name || !last_name.trim()) {
    return res
      .status(400)
      .json({ message: "กรุณากรอกชื่อจริงและนามสกุลให้ครบถ้วน" });
  }
  if (!email || !email.trim()) {
    return res.status(400).json({ message: "กรุณาระบุอีเมล" });
  }
  if (!isValidPhone(phone)) {
    return res.status(400).json({
      message: "กรุณาระบุเบอร์โทรศัพท์ให้ถูกต้อง (ตัวเลข 9-10 หลัก ขึ้นต้นด้วย 0)",
    });
  }
  if (!VALID_USER_TYPES.includes(user_type)) {
    return res.status(400).json({ message: "กรุณาเลือกประเภทผู้ใช้งานให้ถูกต้อง" });
  }
  if (!pending_id) {
    return res
      .status(400)
      .json({ message: "ไม่พบข้อมูลการสมัครผ่าน LINE กรุณาลองใหม่อีกครั้ง" });
  }

  const client = await db.getClient();

  try {
    await client.query("BEGIN");

    const pendingResult = await client.query(
      `SELECT line_user_id, picture_url
       FROM line_pending_signups
       WHERE id = $1 AND expires_at > CURRENT_TIMESTAMP`,
      [pending_id],
    );
    if (pendingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: "ลิงก์หมดอายุหรือไม่ถูกต้อง กรุณาเริ่มสมัครผ่าน LINE ใหม่อีกครั้ง",
      });
    }
    const lineUserId = pendingResult.rows[0].line_user_id;
    const pictureUrl = pendingResult.rows[0].picture_url;

    // กันเคสเปิดค้างหลายแท็บแล้วกดยืนยันซ้ำ (บัญชี LINE นี้ถูกสร้างไปแล้วระหว่างที่ฟอร์มเปิดค้างไว้)
    const alreadyLinked = await client.query(
      "SELECT id FROM users WHERE line_user_id = $1",
      [lineUserId],
    );
    if (alreadyLinked.rows.length > 0) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "บัญชี LINE นี้เคยสมัครสมาชิกไปแล้ว กรุณาเข้าสู่ระบบแทน" });
    }

    const checkEmail = await client.query(
      "SELECT id FROM profiles WHERE email = $1",
      [email],
    );
    if (checkEmail.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "อีเมลนี้ถูกใช้งานแล้ว" });
    }

    // บัญชีที่สมัครผ่าน LINE ไม่มี username/password ที่ผู้ใช้ตั้งเอง - สุ่ม username ให้
    // (กันชนกับ username ที่มีอยู่แล้ว) และตั้งรหัสผ่านเป็นค่าสุ่มที่ไม่มีใครรู้ ล็อกอินด้วย
    // username/password แบบเดิมไม่ได้จริง ต้อง login ผ่าน LINE เท่านั้น
    let username = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `line_${crypto.randomBytes(6).toString("hex")}`;
      const checkUsername = await client.query(
        "SELECT id FROM users WHERE username = $1",
        [candidate],
      );
      if (checkUsername.rows.length === 0) {
        username = candidate;
        break;
      }
    }
    if (!username) {
      await client.query("ROLLBACK");
      return res.status(500).json({ message: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" });
    }

    const randomPassword = crypto.randomBytes(32).toString("hex");
    const hashedPassword = await bcrypt.hash(randomPassword, 10);
    const verificationToken = crypto.randomBytes(32).toString("hex");

    // 1. บันทึกลงตาราง users (role='user' เสมอ - สมัครด่วนผ่าน LINE รองรับเฉพาะบุคคลทั่วไป
    // สมัครแบบหน่วยงานยังต้องผ่านฟอร์มเดิมเท่านั้น)
    const userInsertResult = await client.query(
      `INSERT INTO users (username, password, role, user_type, line_user_id)
       VALUES ($1, $2, 'user', $3, $4) RETURNING id`,
      [username, hashedPassword, user_type, lineUserId],
    );
    const newUserId = userInsertResult.rows[0].id;

    // --- สร้าง Format ID (เช่น USR-2604-00001) เหมือนสมัครแบบปกติทุกอย่าง ---
    const date = new Date();
    const yy = String(date.getFullYear()).slice(-2);
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const paddedId = String(newUserId).padStart(5, "0");
    const userCode = `USR-${yy}${mm}-${paddedId}`;

    // 2. บันทึกลงตาราง profiles (profile_image_url = รูปจาก LINE โดยตรง ไม่ต้องโหลดมาเก็บเอง)
    await client.query(
      `INSERT INTO profiles
       (user_id, user_code, first_name_th, last_name_th, email, mobile, profile_image_url, verification_token, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        newUserId,
        userCode,
        first_name.trim(),
        last_name.trim(),
        email,
        phone,
        pictureUrl,
        verificationToken,
        false,
      ],
    );

    await client.query("DELETE FROM line_pending_signups WHERE id = $1", [
      pending_id,
    ]);

    await client.query("COMMIT");

    // ส่งอีเมลยืนยันเฉพาะตอนระบบเปิดบังคับยืนยันอีเมลไว้เท่านั้น เหมือน flow สมัครปกติทุกอย่าง
    // (require_email_verification เปิด/ปิดได้ที่หน้าตั้งค่าระบบเหมือนกันหมดไม่ว่าจะสมัครทางไหน)
    const { require_email_verification } = await getAppSettings();
    if (require_email_verification) {
      const verificationUrl = `${process.env.MYAPP_BACKEND_URL}/auth/verify-email?token=${verificationToken}`;
      const html = buildVerificationEmailHtml(userCode, verificationUrl);
      try {
        await sendMail(email, "ยืนยันการลงทะเบียนระบบ Ethic AI System", html);
      } catch (mailError) {
        console.error("Mail Delivery Failed:", mailError);
      }
    }

    // ล็อกอินให้ทันที (ต่างจากสมัครแบบปกติที่ต้องไปกดล็อกอินเอง) เพราะผู้ใช้ไม่รู้ username/
    // password ที่สุ่มให้เอง จะให้ไปกรอกฟอร์ม login เองไม่ได้อยู่แล้ว
    const token = jwt.sign(
      { id: newUserId, role: "user" },
      process.env.MYAPP_JWT_SECRET,
      { expiresIn: "1d" },
    );

    res.status(201).json({
      message: "ลงทะเบียนสำเร็จ",
      token,
      user: {
        id: newUserId,
        user_code: userCode,
        username,
        name: `${first_name.trim()} ${last_name.trim()}`,
        role: "user",
        user_type,
        profile_image_url: pictureUrl,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Complete LINE Register Error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการลงทะเบียน" });
  } finally {
    client.release();
  }
};
