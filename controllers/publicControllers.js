const db = require("../db");

exports.getDashboardStats = async (req, res) => {
  try {
    // 1. นับภาพรวม (ใช้วิธีรันพร้อมกันประหยัดเวลา)
    const [orgs, users, certs, projects] = await Promise.all([
      db.query(`SELECT COUNT(*) as count FROM organizations`),
      db.query(`SELECT COUNT(*) as count FROM users WHERE role = 'user'`), // <-- สังเกตตรงนี้นับเฉพาะ role = 'user' ตามที่คุณขอ
      db.query(`SELECT COUNT(*) as count FROM certificates`),
      db.query(`SELECT COUNT(*) as count FROM projects`),
    ]);

    const summary = {
      totalOrgs: parseInt(orgs.rows[0].count),
      totalUsers: parseInt(users.rows[0].count),
      totalCerts: parseInt(certs.rows[0].count),
      totalProjects: parseInt(projects.rows[0].count),
    };

    // 2. ดึงสัดส่วน User Type
    const userTypesQuery = await db.query(`
      SELECT user_type as name, COUNT(*) as value 
      FROM users 
      WHERE role = 'user' AND user_type IS NOT NULL 
      GROUP BY user_type
    `);

    // (ส่วน Radar, Maturity, Trends คุณสามารถเขียน Query ตามเงื่อนไขที่มี หรือส่งค่าหลอกไปก่อนได้)

    res.status(200).json({
      success: true,
      data: {
        summary,
        userTypes: userTypesQuery.rows,
        // radar: radarQueryData,
        // maturity: maturityQueryData,
        // trends: trendQueryData
      },
    });
  } catch (error) {
    console.error("Dashboard Stats Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
