// รวมฟังก์ชันเรียก LINE Login API (OAuth2 + OpenID Connect) ไว้ที่เดียว - controller เรียกใช้ฟังก์ชัน
// พวกนี้แทนการยิง fetch ตรง ๆ เอง กันโค้ดเรียก LINE API กระจายอยู่หลายที่
// เอกสารอ้างอิง: https://developers.line.biz/en/docs/line-login/integrate-line-login/

const LINE_AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize";
const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";

// URL ที่ backend เราเองต้องลงทะเบียนไว้ใน LINE Developers Console (แท็บ LINE Login > Callback URL)
// ให้ตรงกันเป๊ะ ๆ ไม่งั้น LINE จะปฏิเสธไม่ยอม redirect กลับมา
const getRedirectUri = () =>
  `${process.env.MYAPP_BACKEND_URL}/auth/line/callback`;

// สร้าง URL ให้ browser ผู้ใช้ไปหน้า "อนุญาต" ของ LINE
// state = ค่าที่เราสร้างเอง (เป็น JWT เซ็นชื่อไว้ ดู controller) ใช้ตรวจตอน callback กลับมาว่า
// เป็น request ที่เราเริ่มเองจริง ๆ ไม่ใช่ CSRF จากที่อื่น
const getLineAuthorizeUrl = (state) => {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.MYAPP_LINE_CHANNEL_ID,
    redirect_uri: getRedirectUri(),
    state,
    scope: "profile openid email",
  });
  return `${LINE_AUTHORIZE_URL}?${params.toString()}`;
};

// แลก authorization code เป็น access_token + id_token
const exchangeCodeForToken = async (code) => {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(),
    client_id: process.env.MYAPP_LINE_CHANNEL_ID,
    client_secret: process.env.MYAPP_LINE_CHANNEL_SECRET,
  });

  const response = await fetch(LINE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LINE token exchange failed: ${response.status} ${errText}`);
  }

  return response.json(); // { access_token, id_token, ... }
};

// ให้ LINE เป็นคนตรวจ + ถอดรหัส id_token ให้เอง (ปลอดภัยกว่าเราถอด JWT เองโดยไม่ verify
// ลายเซ็น และไม่ต้องพึ่ง library/JWKS เพิ่ม) ได้ข้อมูลโปรไฟล์กลับมาในตัวเดียวกันเลย
// คืนค่า { sub, name, picture, email } - email จะมีค่าก็ต่อเมื่อ channel ได้รับอนุมัติ
// "email permission" จาก LINE แล้วเท่านั้น ไม่งั้นจะเป็น undefined เสมอ
const verifyIdToken = async (idToken) => {
  const body = new URLSearchParams({
    id_token: idToken,
    client_id: process.env.MYAPP_LINE_CHANNEL_ID,
  });

  const response = await fetch(LINE_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`LINE id_token verify failed: ${response.status} ${errText}`);
  }

  return response.json(); // { sub, name, picture, email, ... }
};

module.exports = { getLineAuthorizeUrl, exchangeCodeForToken, verifyIdToken };
