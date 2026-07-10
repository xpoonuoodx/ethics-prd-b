const db = require("../db");

// user_type ที่รองรับการกรอง (ต้องตรงกับตัวเลือกจริงตอนแอดมิน/regulator เพิ่มบุคลากร)
const VALID_USER_TYPES = [
  "regulator",
  "policy",
  "researcher",
  "developer",
  "service provider",
  "users",
];

exports.getDashboardStats = async (req, res) => {
  try {
    const rawUserType = (req.query.user_type || "").trim().toLowerCase();
    const userType = VALID_USER_TYPES.includes(rawUserType)
      ? rawUserType
      : null;
    const typeParam = userType ? [userType] : [];
    const typeCond = userType ? "AND user_type = $1" : "";
    const typeCondU = userType ? "AND u.user_type = $1" : "";

    // 1. นับภาพรวม 4 การ์ด (ใช้วิธีรันพร้อมกันประหยัดเวลา) — กรองตาม user_type ถ้ามีการเลือก
    const [orgs, users, certs, projects] = await Promise.all([
      userType
        ? db.query(
            `SELECT COUNT(DISTINCT organization_id) as count FROM users WHERE role = 'user' AND organization_id IS NOT NULL ${typeCond}`,
            typeParam,
          )
        : db.query(`SELECT COUNT(*) as count FROM organizations`),
      db.query(
        `SELECT COUNT(*) as count FROM users WHERE role = 'user' ${typeCond}`, // <-- นับเฉพาะ role = 'user'
        typeParam,
      ),
      db.query(
        `SELECT COUNT(*) as count
         FROM certificates c
         JOIN users u ON c.user_id = u.id
         WHERE 1=1 ${typeCondU}`,
        typeParam,
      ),
      userType
        ? db.query(
            `SELECT COUNT(DISTINCT p.id) as count
             FROM projects p
             LEFT JOIN users creator ON p.created_by = creator.id
             LEFT JOIN project_members pm ON pm.project_id = p.id
             LEFT JOIN users member ON pm.user_id = member.id
             WHERE creator.user_type = $1 OR member.user_type = $1`,
            typeParam,
          )
        : db.query(`SELECT COUNT(*) as count FROM projects`),
    ]);

    const summary = {
      totalOrgs: parseInt(orgs.rows[0].count),
      totalUsers: parseInt(users.rows[0].count),
      totalCerts: parseInt(certs.rows[0].count),
      totalProjects: parseInt(projects.rows[0].count),
    };

    // 2. ดึงสัดส่วน User Type (ภาพรวมทั้งหมดเสมอ ไม่ผูกกับ filter)
    const userTypesQuery = await db.query(`
      SELECT user_type as name, COUNT(*) as value
      FROM users
      WHERE role = 'user' AND user_type IS NOT NULL
      GROUP BY user_type
    `);

    // 3. เทรนด์ใบประกาศนียบัตรสะสม 6 เดือนล่าสุด (นับสะสมจนถึงสิ้นเดือนนั้นๆ เติม 0 ให้ครบทุกเดือน)
    const trendQuery = await db.query(
      `
      WITH months AS (
        SELECT generate_series(
          DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months',
          DATE_TRUNC('month', CURRENT_DATE),
          INTERVAL '1 month'
        ) AS month_start
      )
      SELECT
        TO_CHAR(m.month_start, 'YYYY-MM') as month,
        (
          SELECT COUNT(*)
          FROM certificates c
          JOIN users u ON c.user_id = u.id
          WHERE c.issued_at < (m.month_start + INTERVAL '1 month') ${typeCondU}
        ) as certs
      FROM months m
      ORDER BY m.month_start ASC
    `,
      typeParam,
    );

    // 4. สัดส่วนระดับความพร้อม (Maturity) จากการประเมินล่าสุดของแต่ละคน
    const maturityQuery = await db.query(
      `
      SELECT ml.level_id, ml.level_name as level, COUNT(*) as count
      FROM (
        SELECT DISTINCT ON (uth.user_id) uth.user_id, uth.maturity_id
        FROM user_tools_history uth
        JOIN users u ON uth.user_id = u.id
        WHERE 1=1 ${typeCondU}
        ORDER BY uth.user_id, uth.created_at DESC
      ) latest
      JOIN maturity_levels ml ON ml.level_id = latest.maturity_id
      GROUP BY ml.level_id, ml.level_name
      ORDER BY ml.level_id ASC
    `,
      typeParam,
    );

    // 5. คะแนนเฉลี่ยจริยธรรมรายหลักการ (ประมาณการจากผลประเมินตนเองในระบบจริง)
    const radarQuery = await db.query(
      `
      SELECT p->>'id' as principle_id,
             p->>'name' as principle_name,
             AVG((uth.maturity_id::float / max_level.max_id) * 100) as avg_score
      FROM user_tools_history uth
      JOIN users u ON uth.user_id = u.id
      CROSS JOIN LATERAL jsonb_array_elements(uth.result_data->'principles') AS p
      CROSS JOIN (SELECT MAX(level_id) as max_id FROM maturity_levels WHERE is_active = true) max_level
      WHERE 1=1 ${typeCondU}
      GROUP BY p->>'id', p->>'name'
      ORDER BY p->>'id' ASC
    `,
      typeParam,
    );

    res.status(200).json({
      success: true,
      data: {
        summary,
        userTypes: userTypesQuery.rows,
        trend: trendQuery.rows,
        maturityDistribution: maturityQuery.rows,
        radar: radarQuery.rows,
      },
    });
  } catch (error) {
    console.error("Dashboard Stats Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
