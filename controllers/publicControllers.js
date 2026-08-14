const db = require("../db");

// จับคู่ user_type รายบุคคล เข้ากลุ่มบทบาทใหญ่ 3 กลุ่ม (ใช้ pattern เดียวกับที่ userControllers.js ใช้แบ่ง target_group)
const ROLE_BUCKETS = [
  {
    key: "executive",
    label: "กลุ่มผู้บริหาร ผู้กำหนด และผู้กำกับนโยบาย",
    userTypes: ["regulator", "policy"],
    targetGroup: 1,
  },
  {
    key: "developer",
    label: "กลุ่มนักวิจัย นักพัฒนา และโปรแกรมเมอร์",
    userTypes: ["researcher", "developer", "service provider"],
    targetGroup: 2,
  },
  {
    key: "general",
    label: "กลุ่มผู้ใช้งานทั่วไป และผู้มีผลกระทบ",
    userTypes: ["users"],
    targetGroup: 3,
  },
];

const SECTOR_LABELS = {
  government: "ภาครัฐ",
  finance: "การเงินและการธนาคาร",
  healthcare: "สาธารณสุข",
  education: "การศึกษา",
  industry: "อุตสาหกรรม",
  commerce: "พาณิชย์และบริการ",
  other: "อื่นๆ",
};

// คำนวณ % เปลี่ยนแปลงเทียบกับยอดสะสม ณ สิ้นเดือนก่อนหน้า (กันหารด้วยศูนย์)
const calcDeltaPct = (totalNow, totalLastMonthEnd) => {
  if (!totalLastMonthEnd) return totalNow > 0 ? 100 : 0;
  return Math.round(((totalNow - totalLastMonthEnd) / totalLastMonthEnd) * 1000) / 10;
};

exports.getDashboardStats = async (req, res) => {
  try {
    // 1. โครงการทั้งหมด + เทียบเดือนก่อนหน้า
    const projectCountRes = await db.query(`
      SELECT
        COUNT(*) as total_now,
        COUNT(*) FILTER (WHERE created_at < DATE_TRUNC('month', CURRENT_DATE)) as total_last_month_end
      FROM projects
    `);

    // 2. ผู้ใช้งานทั้งหมด (role = 'user') + เทียบเดือนก่อนหน้า
    const userCountRes = await db.query(`
      SELECT
        COUNT(*) as total_now,
        COUNT(*) FILTER (WHERE created_at < DATE_TRUNC('month', CURRENT_DATE)) as total_last_month_end
      FROM users WHERE role = 'user'
    `);

    // 3. สถานะโครงการทั้งระบบ (ปฏิบัติตาม / ต้องปรับปรุง / อยู่ระหว่างประเมิน)
    //    ปฏิบัติตาม = สมาชิกทุกคนทำเครื่องมือประเมินครบแล้ว, ต้องปรับปรุง = ทำแล้วบางส่วน, อยู่ระหว่างประเมิน = ยังไม่มีใครทำเลย
    const projectStatusRes = await db.query(`
      SELECT
        p.id,
        (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) as total_members,
        (SELECT COUNT(*) FROM project_members pm
           WHERE pm.project_id = p.id
           AND EXISTS (SELECT 1 FROM user_tools_history uth WHERE uth.user_id = pm.user_id)
        ) as completed_members
      FROM projects p
    `);

    let compliantProjects = 0;
    let needsImprovementProjects = 0;
    let underAssessmentProjects = 0;
    projectStatusRes.rows.forEach((row) => {
      const total = parseInt(row.total_members) || 0;
      const completed = parseInt(row.completed_members) || 0;
      if (total > 0 && completed === total) compliantProjects++;
      else if (completed > 0) needsImprovementProjects++;
      else underAssessmentProjects++;
    });

    // 4. สัดส่วนโครงการ AI จำแนกตามภาคส่วน (sector ของหน่วยงานเจ้าของโครงการ)
    const sectorRes = await db.query(`
      SELECT COALESCE(o.sector, 'other') as sector, COUNT(p.id) as count
      FROM projects p
      JOIN organizations o ON p.organization_id = o.id
      GROUP BY COALESCE(o.sector, 'other')
      ORDER BY count DESC
    `);

    // 5. คะแนนจริยธรรมเฉลี่ย + สัดส่วนระดับ Maturity จำแนกตาม 3 กลุ่มบทบาท
    //    ใช้ผลประเมินล่าสุดของแต่ละคนเท่านั้น (DISTINCT ON ... ORDER BY created_at DESC)
    const roleMaturityRes = await db.query(`
      SELECT
        latest.user_type,
        latest.maturity_id,
        ml.level_name,
        max_level.max_id
      FROM (
        SELECT DISTINCT ON (uth.user_id) uth.user_id, uth.maturity_id, u.user_type
        FROM user_tools_history uth
        JOIN users u ON uth.user_id = u.id
        ORDER BY uth.user_id, uth.created_at DESC
      ) latest
      JOIN maturity_levels ml ON ml.level_id = latest.maturity_id
      CROSS JOIN (SELECT MAX(level_id) as max_id FROM maturity_levels WHERE is_active = true) max_level
    `);

    // 6. จำนวนผู้ลงทะเบียนและผู้ผ่านเกณฑ์ใบประกาศฯ จำแนกตาม 3 กลุ่มบทบาท (course_group ตรงกับ target_group ของกลุ่ม)
    const [registeredRes, passedRes] = await Promise.all([
      db.query(`
        SELECT user_type, COUNT(*) as count
        FROM users
        WHERE role = 'user' AND user_type IS NOT NULL
        GROUP BY user_type
      `),
      db.query(`
        SELECT c.course_group, COUNT(DISTINCT c.user_id) as count
        FROM certificates c
        GROUP BY c.course_group
      `),
    ]);

    const registeredByType = {};
    registeredRes.rows.forEach((row) => {
      registeredByType[row.user_type] = parseInt(row.count);
    });
    const passedByGroup = {};
    passedRes.rows.forEach((row) => {
      passedByGroup[row.course_group] = parseInt(row.count);
    });

    // ประกอบข้อมูลตาม 3 กลุ่มบทบาท
    const roleStats = ROLE_BUCKETS.map((bucket) => {
      const rowsInBucket = roleMaturityRes.rows.filter((r) =>
        bucket.userTypes.includes(r.user_type),
      );
      const totalInBucket = rowsInBucket.length;
      const avgScorePct =
        totalInBucket === 0
          ? 0
          : Math.round(
              (rowsInBucket.reduce(
                (sum, r) => sum + (r.maturity_id / r.max_id) * 100,
                0,
              ) /
                totalInBucket) *
                10,
            ) / 10;

      const levelCounts = {};
      rowsInBucket.forEach((r) => {
        levelCounts[r.maturity_id] = (levelCounts[r.maturity_id] || 0) + 1;
      });
      const levels = Object.entries(levelCounts)
        .map(([levelId, count]) => ({
          level_id: parseInt(levelId),
          count,
          pct:
            totalInBucket === 0
              ? 0
              : Math.round((count / totalInBucket) * 1000) / 10,
        }))
        .sort((a, b) => b.level_id - a.level_id);

      return {
        key: bucket.key,
        label: bucket.label,
        totalAssessed: totalInBucket,
        avgScorePct,
        levels,
      };
    });

    const courseStats = ROLE_BUCKETS.map((bucket) => {
      const registered = bucket.userTypes.reduce(
        (sum, t) => sum + (registeredByType[t] || 0),
        0,
      );
      const passed = passedByGroup[bucket.targetGroup] || 0;
      const passRate =
        registered === 0 ? 0 : Math.round((passed / registered) * 1000) / 10;
      return {
        key: bucket.key,
        label: bucket.label,
        registered,
        passed,
        notPassed: Math.max(registered - passed, 0),
        passRate,
      };
    });

    const sectorDistribution = sectorRes.rows.map((row) => ({
      sector: row.sector,
      label: SECTOR_LABELS[row.sector] || row.sector,
      count: parseInt(row.count),
    }));

    const totalProjectsNow = parseInt(projectCountRes.rows[0].total_now) || 0;
    const totalUsersNow = parseInt(userCountRes.rows[0].total_now) || 0;

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalProjects: totalProjectsNow,
          totalProjectsDeltaPct: calcDeltaPct(
            totalProjectsNow,
            parseInt(projectCountRes.rows[0].total_last_month_end) || 0,
          ),
          totalUsers: totalUsersNow,
          totalUsersDeltaPct: calcDeltaPct(
            totalUsersNow,
            parseInt(userCountRes.rows[0].total_last_month_end) || 0,
          ),
          compliantProjects,
          compliantPct:
            totalProjectsNow === 0
              ? 0
              : Math.round((compliantProjects / totalProjectsNow) * 1000) / 10,
          needsImprovementProjects,
          needsImprovementPct:
            totalProjectsNow === 0
              ? 0
              : Math.round(
                  (needsImprovementProjects / totalProjectsNow) * 1000,
                ) / 10,
          underAssessmentProjects,
          underAssessmentPct:
            totalProjectsNow === 0
              ? 0
              : Math.round(
                  (underAssessmentProjects / totalProjectsNow) * 1000,
                ) / 10,
        },
        sectorDistribution,
        roleStats,
        courseStats,
      },
    });
  } catch (error) {
    console.error("Dashboard Stats Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// พร็อกซีรูปภาพแม่แบบใบประกาศ (background/logo/signature) ให้ html2canvas อ่านพิกเซลได้
// ปัญหาเดิม: รูปที่โฮสต์นอกโดเมนเรา (เช่น cdn.phototourl.com) ไม่ได้ส่ง header
// Access-Control-Allow-Origin กลับมา ทำให้หน้าเว็บโชว์รูปได้ปกติ (แค่ paint ไม่ต้องขอ CORS)
// แต่ html2canvas ต้องอ่านพิกเซลจริงตอนแปลงเป็น PDF เลยได้ภาพว่างเปล่า
// จำกัดให้พร็อกซีได้เฉพาะ URL ที่ admin ตั้งค่าไว้ใน certificate_settings จริงเท่านั้น
// กัน endpoint นี้ถูกใช้เป็นช่องทาง SSRF ไปยิง URL อื่นที่ไม่เกี่ยวข้อง
exports.proxyImage = async (req, res) => {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ message: "กรุณาระบุ url" });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ message: "url ไม่ถูกต้อง" });
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return res.status(400).json({ message: "รองรับเฉพาะ http/https" });
  }

  try {
    const allowedResult = await db.query(
      `SELECT 1 FROM certificate_settings
       WHERE background_url = $1 OR logo_url = $1 OR signature_url = $1
       LIMIT 1`,
      [url],
    );
    if (allowedResult.rows.length === 0) {
      return res.status(403).json({ message: "ไม่อนุญาตให้พร็อกซี URL นี้" });
    }

    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(502).json({ message: "ดึงรูปภาพต้นทางไม่สำเร็จ" });
    }

    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      return res.status(415).json({ message: "URL นี้ไม่ใช่รูปภาพ" });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.set({
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    });
    res.send(buffer);
  } catch (error) {
    console.error("Proxy Image Error:", error);
    res.status(502).json({ message: "ดึงรูปภาพต้นทางไม่สำเร็จ" });
  }
};

// ตรวจสอบใบประกาศนียบัตรจากเลขที่ (สแกนจาก QR บนใบเซอร์) - เปิดสาธารณะ ไม่ต้อง login
// เลขที่ต้องเป็นรูปแบบใหม่ (dev-2600001 ฯลฯ) เท่านั้น ใบเก่าก่อนมีระบบนี้ (cert_number เป็น NULL)
// ยังไม่รองรับตรวจสอบผ่านหน้านี้ ตามที่ตกลงกันไว้ - เอาไว้ทำเพิ่มทีหลังได้ถ้าต้องการ
// ส่งกลับเฉพาะข้อมูลที่โชว์อยู่บนตัวใบเซอร์เองอยู่แล้ว (ไม่มีอีเมล/คะแนนสอบ เพราะหน้านี้ไม่ต้อง login ใครก็เข้าดูได้)
exports.verifyCertificate = async (req, res) => {
  const { certNumber } = req.params;
  if (!certNumber) {
    return res.status(400).json({ success: false, message: "กรุณาระบุเลขที่ใบประกาศ" });
  }

  try {
    const result = await db.query(
      `SELECT
         c.cert_number, c.issued_at,
         p.first_name_th || ' ' || p.last_name_th AS user_name,
         cs.course_name, cs.issuer_name, cs.signatory_name, cs.signatory_position
       FROM certificates c
       JOIN users u ON c.user_id = u.id
       LEFT JOIN profiles p ON u.id = p.user_id
       LEFT JOIN certificate_settings cs ON c.course_group = cs.course_group
       WHERE c.cert_number = $1`,
      [certNumber],
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลใบประกาศนี้ในระบบ" });
    }

    const row = result.rows[0];
    res.status(200).json({
      success: true,
      data: {
        certNumber: row.cert_number,
        userName: row.user_name,
        courseName: row.course_name,
        issuerName: row.issuer_name,
        signatoryName: row.signatory_name,
        signatoryPosition: row.signatory_position,
        issuedDate: new Date(row.issued_at).toLocaleDateString("th-TH", {
          year: "numeric",
          month: "long",
          day: "numeric",
          timeZone: "Asia/Bangkok",
        }),
      },
    });
  } catch (error) {
    console.error("Verify Certificate Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการตรวจสอบใบประกาศ" });
  }
};
