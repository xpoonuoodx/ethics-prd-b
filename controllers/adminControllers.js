const db = require("../db");
const bcrypt = require("bcryptjs");

// 1. ดึงข้อมูลหน้า Dashboard (ภาพรวม)
exports.getDashboard = async (req, res) => {
  try {
    const statsResult = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM organizations) as total_organizations,
        (SELECT COUNT(*) FROM users WHERE role = 'regulator') as total_regulators,
        (SELECT COUNT(*) FROM projects) as total_projects,
        (SELECT COUNT(*) FROM users) as total_users
    `);

    const stats = statsResult.rows[0];

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

    const formattedOrganizations = orgsResult.rows.map((row) => ({
      id: row.org_code || `ORG-${String(row.id).padStart(3, "0")}`,
      name: row.org_name,
      regulatorName: row.regulator_name,
      totalProjects: parseInt(row.total_projects) || 0,
      totalUsers: parseInt(row.total_users) || 0,
      status: row.status || "Active",
    }));

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

// 2. ดึงข้อมูลรายชื่อหน่วยงานทั้งหมด (สำหรับหน้าจัดการหน่วยงาน)
exports.getOrganizations = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        o.id as db_id,
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

    // จัด Format ให้ตรงกับที่ React คาดหวัง
    const formattedData = result.rows.map((row) => ({
      id: row.org_code,
      name: row.org_name,
      regulatorName: row.regulator_name,
      totalProjects: parseInt(row.total_projects) || 0,
      totalUsers: parseInt(row.total_users) || 0,
      status: row.status || "Active",
    }));

    res.json({ success: true, data: formattedData });
  } catch (error) {
    console.error("Get Organizations Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลหน่วยงาน",
    });
  }
};

// 3. เพิ่มหน่วยงานใหม่
exports.addOrganization = async (req, res) => {
  const { id, name, regulatorName, status } = req.body;

  try {
    // บันทึกเฉพาะโครงสร้างหน่วยงานไปก่อน ตามลำดับการทำงาน (สร้างบ้านก่อนเอาคนเข้าอยู่)
    await db.query(
      "INSERT INTO organizations (org_code, org_name, status) VALUES ($1, $2, $3)",
      [id, name, status],
    );

    res.status(201).json({ success: true, message: "เพิ่มหน่วยงานสำเร็จ" });
  } catch (error) {
    console.error("Add Organization Error Database:", error);

    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการบันทึกข้อมูล",
      error: error.message,
    });
  }
};

// 4. ดึงรายชื่อคนที่มีสิทธิ์เป็นผู้กำกับดูแล (เพื่อใส่ใน Dropdown)
exports.getRegulators = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        u.id, 
        p.first_name_th || ' ' || p.last_name_th AS name 
      FROM users u 
      INNER JOIN profiles p ON u.id = p.user_id 
      WHERE u.role = 'regulator'
    `);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Get Regulators Error:", error);
    res.status(500).json({
      success: false,
      message: "ดึงข้อมูลผู้กำกับดูแลผิดพลาด",
    });
  }
};

// 5. ดึงข้อมูลรายชื่อผู้ใช้งานระบบทั้งหมด (สำหรับหน้าจัดการผู้ใช้งาน)
exports.getUsers = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        u.id, 
        u.username, 
        u.role, 
        p.first_name_th || ' ' || p.last_name_th AS name, 
        o.org_name 
      FROM users u 
      LEFT JOIN profiles p ON u.id = p.user_id 
      LEFT JOIN organizations o ON u.organization_id = o.id
      ORDER BY u.created_at DESC
    `);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Get Users Error:", error);
    res.status(500).json({
      success: false,
      message: "ดึงข้อมูลผู้ใช้งานผิดพลาด",
    });
  }
};

exports.addUser = async (req, res) => {
  // รับข้อมูลเพิ่มเติม email และ id_card จากหน้าบ้าน
  const { username, password, name, email, id_card, role, org_id } = req.body;

  try {
    // เริ่มต้น Transaction ผ่านตัว db.query ตรงๆ ตามที่ต้องการ
    await db.query("BEGIN");

    // ตรวจสอบความซ้ำซ้อนของชื่อผู้ใช้งานในระบบ
    const checkUser = await db.query(
      "SELECT id FROM users WHERE username = $1",
      [username],
    );

    if (checkUser.rows.length > 0) {
      await db.query("ROLLBACK");
      return res
        .status(400)
        .json({ success: false, message: "ชื่อผู้ใช้งานนี้ถูกใช้ไปแล้ว" });
    }

    // เข้ารหัสผ่านเพื่อความปลอดภัย
    const hashedPassword = await bcrypt.hash(password, 10);

    // ตรวจสอบและจัดการชนิดข้อมูลของ org_id ป้องกันข้อผิดพลาด Data Type Mismatch (Error 500)
    let finalOrgId = null;
    if (org_id && org_id !== "") {
      // หากค่าที่ส่งมาเป็นข้อความ String (เช่น ORG-001) ให้แปลงหา ID จริงที่เป็นตัวเลขก่อน
      if (isNaN(org_id)) {
        const getOrg = await db.query(
          "SELECT id FROM organizations WHERE org_code = $1",
          [org_id],
        );
        if (getOrg.rows.length > 0) {
          finalOrgId = getOrg.rows[0].id;
        }
      } else {
        // หากส่งมาเป็นค่าตัวเลขตัวตรงอยู่แล้ว ให้แปลงเป็น Integer ทันที
        finalOrgId = parseInt(org_id);
      }
    }

    // 1. สั่งบันทึกข้อมูลหลักลงในตาราง users พร้อมรับค่า id ล่าสุดกลับมาใช้งาน
    const insertUser = await db.query(
      `
      INSERT INTO users (username, password, role, organization_id) 
      VALUES ($1, $2, $3, $4) RETURNING id
    `,
      [username, hashedPassword, role, finalOrgId],
    );

    const newUserId = insertUser.rows[0].id;

    // แยกชื่อจริงและนามสกุลออกจากกันเพื่อนำไปจัดเก็บลงตาราง profiles
    const nameParts = name.trim().split(" ");
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    // 2. สั่งบันทึกข้อมูลส่วนบุคคลลงตาราง profiles พร้อมผูกข้อมูล email และ id_card ที่ส่งมาจากหน้าบ้าน
    await db.query(
      `
      INSERT INTO profiles (user_id, first_name_th, last_name_th, email, id_card, is_verified) 
      VALUES ($1, $2, $3, $4, $5, true)
    `,
      [newUserId, firstName, lastName, email, id_card],
    );

    // ยืนยันการบันทึกข้อมูลทั้งหมดลงฐานข้อมูลระบบ
    await db.query("COMMIT");
    res
      .status(201)
      .json({ success: true, message: "เพิ่มบัญชีผู้ใช้งานสำเร็จ" });
  } catch (error) {
    // ในกรณีที่เกิดข้อผิดพลาดใดๆ ขึ้นระหว่างทำงาน ให้ทำการคืนค่าระบบเดิม (Rollback) ทันที
    await db.query("ROLLBACK");
    console.error("Add User Error Backend:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการบันทึกบัญชีลงฐานข้อมูล",
    });
  }
};

exports.viewOrganization = async (req, res) => {
  const { id } = req.params;

  try {
    // 1. ดึงข้อมูลภาพรวมของหน่วยงาน
    const orgResult = await db.query(
      `
      SELECT 
        o.id as db_id,
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
      WHERE o.org_code = $1 OR o.id::text = $1
    `,
      [id],
    );

    if (orgResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูลหน่วยงานนี้ในระบบ",
      });
    }

    const orgData = orgResult.rows[0];

    // 2. ดึงข้อมูลรายชื่อผู้ใช้งานทั้งหมดในหน่วยงานนี้ (ยกเว้น admin)
    const usersResult = await db.query(
      `
      SELECT 
        u.id, 
        u.username, 
        u.role, 
        p.first_name_th || ' ' || p.last_name_th AS name,
        p.email
      FROM users u 
      INNER JOIN profiles p ON u.id = p.user_id 
      WHERE u.organization_id = $1 AND u.role != 'admin'
      ORDER BY u.created_at DESC
    `,
      [orgData.db_id],
    );

    // 3. ดึงรายการโครงการ พร้อมนับจำนวนคน และรวบรวมรายชื่อคนที่อยู่ในโครงการนี้ (Join ตาราง project_members)
    const projectsResult = await db.query(
      `
      SELECT 
        p.id, 
        p.project_name, 
        p.status, 
        p.created_at,
        COUNT(pm.user_id) as member_count,
        COALESCE(
          json_agg(
            json_build_object(
              'id', u.id,
              'name', pr.first_name_th || ' ' || pr.last_name_th,
              'username', u.username
            )
          ) FILTER (WHERE u.id IS NOT NULL), '[]'::json
        ) as members
      FROM projects p
      LEFT JOIN project_members pm ON p.id = pm.project_id
      LEFT JOIN users u ON pm.user_id = u.id
      LEFT JOIN profiles pr ON u.id = pr.user_id
      WHERE p.organization_id = $1
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `,
      [orgData.db_id],
    );

    // 4. ส่งกลับข้อมูล (แยก projects ออกมาไว้ระดับเดียวกับ users ตามที่ Frontend ใช้งาน)
    res.json({
      success: true,
      data: {
        organization: {
          id:
            orgData.org_code || `ORG-${String(orgData.db_id).padStart(3, "0")}`,
          name: orgData.org_name,
          regulatorName: orgData.regulator_name,
          totalProjects: parseInt(orgData.total_projects) || 0,
          totalUsers: parseInt(orgData.total_users) || 0,
          status: orgData.status || "Active",
        },
        users: usersResult.rows,
        projects: projectsResult.rows, // ส่ง Array โครงการไปให้หน้าบ้าน
      },
    });
  } catch (error) {
    console.error("View Organization Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลรายละเอียดหน่วยงาน",
    });
  }
};
