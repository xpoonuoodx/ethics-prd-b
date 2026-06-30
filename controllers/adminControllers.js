const db = require("../db"); 

// --- GET ADMIN DASHBOARD ---
exports.getDashboard = async (req, res) => {
  try {
    // 1. ดึงข้อมูลสถิติภาพรวม 4 ใบ (Quick Stats)
    const statsResult = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM organizations) as total_organizations,
        (SELECT COUNT(*) FROM users WHERE role = 'regulator') as total_regulators,
        (SELECT COUNT(*) FROM projects) as total_projects,
        (SELECT COUNT(*) FROM users) as total_users
    `);

    const stats = statsResult.rows[0];

    // 2. ดึงข้อมูลตารางรายชื่อหน่วยงาน พร้อมข้อมูล Regulator และสถิติย่อย
    // ใช้ Subquery ในการดึงชื่อจริงจากตาราง profiles มาแสดงแทน
    const orgsResult = await db.query(`
      SELECT 
        o.id,
        o.org_code,
        o.org_name,
        o.status,
        COALESCE(
          (SELECT p.first_name_th || ' ' || p.last_name_th 
           FROM users u 
           JOIN profiles p ON u.id = p.user_id 
           WHERE u.organization_id = o.id AND u.role = 'regulator' 
           LIMIT 1), 
          'ยังไม่มีผู้ดูแล'
        ) as regulator_name,
        (SELECT COUNT(*) FROM projects p WHERE p.organization_id = o.id) as total_projects,
        (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id) as total_users
      FROM organizations o
      ORDER BY o.created_at DESC
    `);

    // 3. จัดฟอร์แมตข้อมูลให้อยู่ในรูปแบบที่ Frontend ของ React ต้องการ (อิงตาม Mock Data เดิม)
    const formattedOrganizations = orgsResult.rows.map((row) => ({
      id: row.org_code || `ORG-${String(row.id).padStart(3, "0")}`,
      name: row.org_name,
      regulatorName: row.regulator_name,
      totalProjects: parseInt(row.total_projects) || 0,
      totalUsers: parseInt(row.total_users) || 0,
      status: row.status || "Active",
    }));

    // 4. ส่งผลลัพธ์กลับไปให้ Frontend
    res.status(200).json({
      success: true,
      message: "ดึงข้อมูลแดชบอร์ดสำเร็จ",
      data: {
        summary: {
          totalOrganizations: parseInt(stats.total_organizations) || 0,
          totalRegulators: parseInt(stats.total_regulators) || 0,
          totalProjects: parseInt(stats.total_projects) || 0,
          totalUsers: parseInt(stats.total_users) || 0,
        },
        organizations: formattedOrganizations,
      },
    });
  } catch (error) {
    console.error("Get Admin Dashboard Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลฐานข้อมูล",
    });
  }
};
