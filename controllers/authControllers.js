const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("../db"); // เชื่อมต่อกับ Neon (pg pool)
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const { isValidUsername, isValidPassword } = require("../utils/validators");

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
      `SELECT u.id, u.username, u.password, u.role, 
              p.is_verified, p.first_name_th, p.last_name_th, p.user_code 
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

    // ตรวจสอบสถานะการยืนยันอีเมล
    // ปิดชั่วคราวเพื่อให้สมัครแล้วล็อกอินใช้งานได้ทันทีสำหรับรอบอบรม (TODO: เปิดกลับคืนหลังอบรมเสร็จ)
    // if (!user.is_verified) {
    //   return res.status(403).json({
    //     message: "บัญชีของคุณยังไม่ได้ยืนยันตัวตน กรุณาตรวจสอบอีเมลของคุณ",
    //   });
    // }

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
    id_card,
    first_name,
    last_name,
    email,
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
  if (!VALID_USER_TYPES.includes(user_type)) {
    return res.status(400).json({ message: "กรุณาเลือกประเภทผู้ใช้งานให้ถูกต้อง" });
  }
  if (isOrganization && (!org_name || org_name.trim() === "")) {
    return res.status(400).json({ message: "กรุณาระบุชื่อหน่วยงาน" });
  }
  if (isOrganization && !VALID_SECTORS.includes(sector)) {
    return res.status(400).json({ message: "กรุณาเลือกกลุ่มอุตสาหกรรม (Sector) ให้ถูกต้อง" });
  }
  // profiles.id_card เป็น NOT NULL + UNIQUE ในฐานข้อมูล ต้องเช็คให้มีค่าก่อน insert เสมอ
  if (!id_card) {
    return res.status(400).json({ message: "กรุณาระบุเลขประจำตัวประชาชน" });
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

    // ตรวจสอบ Email หรือ เลขบัตรประชาชน ซ้ำในตาราง profiles
    // (เช็ค id_card แยกและเฉพาะเมื่อมีค่าจริง ป้องกันไปชนกับแถวอื่นที่ id_card เป็นค่าว่างเหมือนกัน)
    const checkProfile = await client.query(
      "SELECT email FROM profiles WHERE email = $1",
      [email],
    );
    if (checkProfile.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "อีเมลนี้ถูกใช้งานแล้ว" });
    }

    if (id_card) {
      const checkIdCard = await client.query(
        "SELECT id FROM profiles WHERE id_card = $1",
        [id_card],
      );
      if (checkIdCard.rows.length > 0) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ message: "เลขประจำตัวประชาชนนี้ถูกลงทะเบียนแล้ว" });
      }
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
       (user_id, user_code, first_name_th, last_name_th, email, id_card, verification_token, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        newUserId,
        userCode,
        first_name,
        last_name,
        email,
        id_card,
        verificationToken,
        false,
      ],
    );

    await client.query("COMMIT"); // ยืนยันการบันทึกข้อมูลทั้งสองตาราง

    // สร้าง HTML สำหรับอีเมล
    const verificationUrl = `${process.env.MYAPP_BACKEND_URL}/auth/verify-email?token=${verificationToken}`;
    const html = `
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

    // ส่งอีเมล
    try {
      await sendMail(email, "ยืนยันการลงทะเบียนระบบ Ethic AI System", html);
    } catch (mailError) {
      console.error("Mail Delivery Failed:", mailError);
    }

    res
      .status(201)
      .json({ message: "ลงทะเบียนสำเร็จ กรุณาตรวจสอบอีเมลเพื่อยืนยันตัวตน" });
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
