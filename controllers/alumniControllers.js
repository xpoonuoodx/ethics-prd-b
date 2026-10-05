const db = require("../db");
const { maskName } = require("../utils/maskName");

// วันที่ออกใบประกาศฯ ตามเวลาไทย - issued_at เป็น timestamp without time zone ที่เขียนด้วย
// CURRENT_TIMESTAMP ตาม TimeZone ของ session ฐานข้อมูล (Neon = GMT) ถ้าตัดวันที่ตรง ๆ คนที่ได้
// ใบประกาศฯ ช่วง 00:00-07:00 เวลาไทยจะตกไปอยู่รุ่นของวันก่อนหน้า เลยแปลงกลับเป็นเวลาไทยก่อนตัดวัน
const CERT_DATE_SQL = `(c.issued_at AT TIME ZONE current_setting('TimeZone') AT TIME ZONE 'Asia/Bangkok')::date`;

const isValidDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
};

const formatBatch = (row) => ({
  id: row.id,
  name: row.name,
  startDate: row.start_date,
  endDate: row.end_date,
  description: row.description || "",
  alumniCount: parseInt(row.alumni_count) || 0,
});

const BATCH_LIST_SQL = `
  SELECT b.id, b.name, b.start_date, b.end_date, b.description,
    (
      SELECT COUNT(DISTINCT c.user_id)
      FROM certificates c
      WHERE ${CERT_DATE_SQL} BETWEEN b.start_date AND b.end_date
    ) AS alumni_count
  FROM alumni_batches b
  ORDER BY b.start_date DESC, b.id DESC
`;

// ตรวจและทำความสะอาด body ของ POST/PUT - คืนค่า { error } ถ้าไม่ผ่าน
const validateBatchBody = (body) => {
  const name = (body.name || "").trim();
  const description = (body.description || "").trim();
  const { start_date: startDate, end_date: endDate } = body;

  if (!name) return { error: "กรุณาระบุชื่อรุ่น" };
  if (name.length > 255) return { error: "ชื่อรุ่นต้องไม่เกิน 255 ตัวอักษร" };
  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    return { error: "รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)" };
  }
  if (startDate > endDate) {
    return { error: "วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด" };
  }
  return { name, description: description || null, startDate, endDate };
};

// หาว่าช่วงวันที่นี้ทับกับรุ่นอื่นหรือไม่ (ช่วงของแต่ละรุ่นห้ามทับกัน ไม่งั้นคนเดียวกันจะนับอยู่หลายรุ่น)
const findOverlap = async (startDate, endDate, excludeId = null) => {
  const result = await db.query(
    `SELECT id, name FROM alumni_batches
     WHERE start_date <= $2 AND end_date >= $1 AND ($3::int IS NULL OR id <> $3)
     LIMIT 1`,
    [startDate, endDate, excludeId],
  );
  return result.rows[0] || null;
};

// ---------------------- Public ----------------------

// รายการรุ่นทั้งหมด (ใหม่สุดก่อน) พร้อมจำนวนผู้จบ - ไม่ส่งชื่อคนออกไปในรายการนี้
exports.getPublicBatches = async (req, res) => {
  try {
    const result = await db.query(BATCH_LIST_SQL);
    res.status(200).json({ success: true, data: result.rows.map(formatBatch) });
  } catch (error) {
    console.error("Get Public Alumni Batches Error:", error);
    res
      .status(500)
      .json({ success: false, message: "ไม่สามารถดึงข้อมูลรุ่นได้" });
  }
};

// รายชื่อผู้จบของรุ่นหนึ่ง - ชื่อถูกปิดบังที่ฝั่ง server ก่อนส่ง ไม่ให้ชื่อเต็มหลุดไปถึง browser
exports.getPublicBatchAlumni = async (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) {
    return res
      .status(400)
      .json({ success: false, message: "รหัสรุ่นไม่ถูกต้อง" });
  }

  try {
    const batchResult = await db.query(
      "SELECT id, name, start_date, end_date, description FROM alumni_batches WHERE id = $1",
      [id],
    );
    if (batchResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบรุ่นที่ต้องการ" });
    }
    const batch = batchResult.rows[0];

    // 1 คนต่อ 1 แถว (ถ้ามีหลายใบในรุ่นเดียวกัน เอาใบแรก) เรียงตามเวลาที่ได้รับใบประกาศฯ
    const alumniResult = await db.query(
      `SELECT first_name_th, last_name_th
       FROM (
         SELECT DISTINCT ON (c.user_id)
           c.user_id, c.issued_at, c.id AS cert_id, p.first_name_th, p.last_name_th
         FROM certificates c
         JOIN profiles p ON p.user_id = c.user_id
         WHERE ${CERT_DATE_SQL} BETWEEN $1 AND $2
         ORDER BY c.user_id, c.issued_at, c.id
       ) first_cert
       ORDER BY issued_at, cert_id`,
      [batch.start_date, batch.end_date],
    );

    const alumni = alumniResult.rows.map((row, index) => ({
      no: index + 1,
      firstName: maskName(row.first_name_th),
      lastName: maskName(row.last_name_th),
    }));

    res.status(200).json({
      success: true,
      data: {
        batch: formatBatch({ ...batch, alumni_count: alumni.length }),
        alumni,
      },
    });
  } catch (error) {
    console.error("Get Public Batch Alumni Error:", error);
    res
      .status(500)
      .json({ success: false, message: "ไม่สามารถดึงรายชื่อผู้จบได้" });
  }
};

// ---------------------- Admin ----------------------

exports.getAdminBatches = async (req, res) => {
  try {
    const result = await db.query(BATCH_LIST_SQL);
    res.status(200).json({ success: true, data: result.rows.map(formatBatch) });
  } catch (error) {
    console.error("Get Admin Alumni Batches Error:", error);
    res
      .status(500)
      .json({ success: false, message: "ไม่สามารถดึงข้อมูลรุ่นได้" });
  }
};

exports.createBatch = async (req, res) => {
  const parsed = validateBatchBody(req.body || {});
  if (parsed.error) {
    return res.status(400).json({ success: false, message: parsed.error });
  }

  try {
    const overlap = await findOverlap(parsed.startDate, parsed.endDate);
    if (overlap) {
      return res.status(409).json({
        success: false,
        message: `ช่วงวันที่ทับกับรุ่น "${overlap.name}"`,
      });
    }

    const result = await db.query(
      `INSERT INTO alumni_batches (name, start_date, end_date, description)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [parsed.name, parsed.startDate, parsed.endDate, parsed.description],
    );
    res.status(201).json({
      success: true,
      message: "เพิ่มรุ่นสำเร็จ",
      data: { id: result.rows[0].id },
    });
  } catch (error) {
    console.error("Create Alumni Batch Error:", error);
    res.status(500).json({ success: false, message: "ไม่สามารถเพิ่มรุ่นได้" });
  }
};

exports.updateBatch = async (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) {
    return res
      .status(400)
      .json({ success: false, message: "รหัสรุ่นไม่ถูกต้อง" });
  }
  const parsed = validateBatchBody(req.body || {});
  if (parsed.error) {
    return res.status(400).json({ success: false, message: parsed.error });
  }

  try {
    const overlap = await findOverlap(
      parsed.startDate,
      parsed.endDate,
      Number(id),
    );
    if (overlap) {
      return res.status(409).json({
        success: false,
        message: `ช่วงวันที่ทับกับรุ่น "${overlap.name}"`,
      });
    }

    const result = await db.query(
      `UPDATE alumni_batches
       SET name = $1, start_date = $2, end_date = $3, description = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING id`,
      [parsed.name, parsed.startDate, parsed.endDate, parsed.description, id],
    );
    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบรุ่นที่ต้องการแก้ไข" });
    }
    res.status(200).json({ success: true, message: "แก้ไขรุ่นสำเร็จ" });
  } catch (error) {
    console.error("Update Alumni Batch Error:", error);
    res.status(500).json({ success: false, message: "ไม่สามารถแก้ไขรุ่นได้" });
  }
};

// ลบเฉพาะรุ่น (ช่วงวันที่) - ไม่กระทบใบประกาศฯ ของผู้ใช้
exports.deleteBatch = async (req, res) => {
  const { id } = req.params;
  if (!/^\d+$/.test(id)) {
    return res
      .status(400)
      .json({ success: false, message: "รหัสรุ่นไม่ถูกต้อง" });
  }

  try {
    const result = await db.query(
      "DELETE FROM alumni_batches WHERE id = $1 RETURNING id",
      [id],
    );
    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบรุ่นที่ต้องการลบ" });
    }
    res.status(200).json({ success: true, message: "ลบรุ่นสำเร็จ" });
  } catch (error) {
    console.error("Delete Alumni Batch Error:", error);
    res.status(500).json({ success: false, message: "ไม่สามารถลบรุ่นได้" });
  }
};
