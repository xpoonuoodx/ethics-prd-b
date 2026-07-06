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

exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. ตรวจสอบว่ามีผู้ใช้งานนี้ในระบบหรือไม่
    const checkUser = await db.query("SELECT * FROM users WHERE id = $1", [id]);
    if (checkUser.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบผู้ใช้งานนี้ในระบบ" });
    }

    // 2. ลบข้อมูลโปรไฟล์ (Profiles) ของผู้ใช้งานคนนี้ออกก่อนเพื่อป้องกันการติด Constraint (Foreign Key)
    await db.query("DELETE FROM profiles WHERE user_id = $1", [id]);

    // 3. ลบข้อมูลออกจากตาราง users หลัก
    await db.query("DELETE FROM users WHERE id = $1", [id]);

    res.status(200).json({ success: true, message: "ลบข้อมูลผู้ใช้งานสำเร็จ" });
  } catch (error) {
    console.error("Delete User Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการลบผู้ใช้งาน อาจมีข้อมูลอื่นผูกมัดอยู่",
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

// ==========================================
// ส่วนของการจัดการหลักการ (Principles)
// ==========================================

// 1. ดึงข้อมูล Principles ทั้งหมด
exports.getPrinciples = async (req, res) => {
  try {
    const result = await db.query(
      "SELECT id, name, description FROM principles ORDER BY id ASC",
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Get Principles Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลหลักการ" });
  }
};

// 2. เพิ่ม Principle ใหม่
exports.addPrinciple = async (req, res) => {
  const { id, name, description } = req.body;

  if (!id || !name) {
    return res.status(400).json({
      success: false,
      message: "กรุณากรอกรหัสและชื่อหลักการให้ครบถ้วน",
    });
  }

  try {
    // เช็คว่ารหัสซ้ำหรือไม่ (เพราะ id เป็น VARCHAR ที่แอดมินกรอกเอง)
    const checkExist = await db.query(
      "SELECT id FROM principles WHERE id = $1",
      [id],
    );
    if (checkExist.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "รหัสหลักการนี้มีอยู่ในระบบแล้ว กรุณาใช้รหัสอื่น",
      });
    }

    await db.query(
      "INSERT INTO principles (id, name, description) VALUES ($1, $2, $3)",
      [id, name, description],
    );

    res.status(201).json({ success: true, message: "เพิ่มหลักการสำเร็จ" });
  } catch (error) {
    console.error("Add Principle Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการเพิ่มข้อมูล" });
  }
};

// 3. แก้ไข Principle
exports.updatePrinciple = async (req, res) => {
  const { id } = req.params; // id เดิมที่ส่งมาจาก URL
  const { name, description } = req.body;

  if (!name) {
    return res
      .status(400)
      .json({ success: false, message: "กรุณากรอกชื่อหลักการ" });
  }

  try {
    const updateQuery = await db.query(
      "UPDATE principles SET name = $1, description = $2 WHERE id = $3 RETURNING id",
      [name, description, id],
    );

    if (updateQuery.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลหลักการที่ต้องการแก้ไข" });
    }

    res.json({ success: true, message: "อัปเดตหลักการสำเร็จ" });
  } catch (error) {
    console.error("Update Principle Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการอัปเดตข้อมูล" });
  }
};

// 4. ลบ Principle
exports.deletePrinciple = async (req, res) => {
  const { id } = req.params;

  try {
    const deleteQuery = await db.query(
      "DELETE FROM principles WHERE id = $1 RETURNING id",
      [id],
    );

    if (deleteQuery.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลที่ต้องการลบ" });
    }

    res.json({ success: true, message: "ลบหลักการสำเร็จ" });
  } catch (error) {
    console.error("Delete Principle Error:", error);
    // ดัก Error กรณีที่หลักการนี้ถูกนำไปอ้างอิงในตารางอื่นแล้ว (Foreign Key Constraint)
    if (error.code === "23503") {
      return res.status(400).json({
        success: false,
        message:
          "ไม่สามารถลบได้ เนื่องจากหลักการนี้ถูกนำไปใช้งานในเกณฑ์การประเมินแล้ว",
      });
    }
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการลบข้อมูล" });
  }
};

exports.getMaturityLevels = async (req, res) => {
  try {
    const result = await db.query(
      "SELECT level_id, level_name, description, is_active FROM maturity_levels ORDER BY level_id ASC",
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Get Maturity Levels Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลระดับความพร้อม",
    });
  }
};

// 2. แก้ไข นิยาม หรือสถานะเปิดใช้งานของ Level
exports.updateMaturityLevel = async (req, res) => {
  const { id } = req.params; // รับค่า level_id มาทาง URL params
  const { level_name, description, is_active } = req.body;

  if (!level_name) {
    return res
      .status(400)
      .json({ success: false, message: "กรุณาระบุชื่อระดับความพร้อม" });
  }

  try {
    const updateQuery = await db.query(
      `UPDATE maturity_levels 
       SET level_name = $1, description = $2, is_active = $3 
       WHERE level_id = $4 RETURNING level_id`,
      [level_name, description, is_active, id],
    );

    if (updateQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูลระดับความพร้อมที่ต้องการแก้ไข",
      });
    }

    res.json({ success: true, message: "อัปเดตเกณฑ์ระดับความพร้อมสำเร็จ" });
  } catch (error) {
    console.error("Update Maturity Level Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกข้อมูล" });
  }
};

exports.getComponents = async (req, res) => {
  try {
    const result = await db.query(
      "SELECT id, role, title, max_maturity_level FROM components ORDER BY id ASC",
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Get Components Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลหัวข้อการประเมิน",
    });
  }
};

// 2. เพิ่ม Component ใหม่
exports.addComponent = async (req, res) => {
  const { id, role, title, max_maturity_level } = req.body;

  if (!id || !role || !title || max_maturity_level === undefined) {
    return res
      .status(400)
      .json({ success: false, message: "กรุณากรอกข้อมูลให้ครบถ้วนทุกช่อง" });
  }

  try {
    // ตรวจสอบรหัส Component ซ้ำ (เนื่องจาก ID แอดมินเป็นคนระบุเอง เช่น ERM01)
    const checkExist = await db.query(
      "SELECT id FROM components WHERE id = $1",
      [id],
    );
    if (checkExist.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "รหัสหัวข้อการประเมินนี้มีอยู่ในระบบแล้ว",
      });
    }

    await db.query(
      "INSERT INTO components (id, role, title, max_maturity_level) VALUES ($1, $2, $3, $4)",
      [id, role, title, parseInt(max_maturity_level)],
    );

    res
      .status(201)
      .json({ success: true, message: "เพิ่มหัวข้อการประเมินสำเร็จ" });
  } catch (error) {
    console.error("Add Component Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกข้อมูล" });
  }
};

// 3. แก้ไข Component
exports.updateComponent = async (req, res) => {
  const { id } = req.params;
  const { role, title, max_maturity_level } = req.body;

  if (!role || !title || max_maturity_level === undefined) {
    return res
      .status(400)
      .json({ success: false, message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
  }

  try {
    const updateQuery = await db.query(
      `UPDATE components 
       SET role = $1, title = $2, max_maturity_level = $3 
       WHERE id = $4 RETURNING id`,
      [role, title, parseInt(max_maturity_level), id],
    );

    if (updateQuery.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลที่ต้องการแก้ไข" });
    }

    res.json({ success: true, message: "อัปเดตหัวข้อการประเมินสำเร็จ" });
  } catch (error) {
    console.error("Update Component Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการอัปเดตข้อมูล" });
  }
};

// 4. ลบ Component
exports.deleteComponent = async (req, res) => {
  const { id } = req.params;

  try {
    const deleteQuery = await db.query(
      "DELETE FROM components WHERE id = $1 RETURNING id",
      [id],
    );

    if (deleteQuery.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลที่ต้องการลบ" });
    }

    res.json({ success: true, message: "ลบหัวข้อการประเมินสำเร็จ" });
  } catch (error) {
    console.error("Delete Component Error:", error);
    // ดักจับ Error กรณีถูกผูกอยู่กับตารางคำถามหรือตารางความสัมพันธ์ Mapping Matrix
    if (error.code === "23503") {
      return res.status(400).json({
        success: false,
        message:
          "ไม่สามารถลบได้ เนื่องจากหัวข้อนี้ถูกนำไปตั้งค่าความสัมพันธ์เกณฑ์จริยธรรม (Matrix) หรือคลังคำถามแล้ว",
      });
    }
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการลบข้อมูล" });
  }
};

exports.getMappingMatrix = async (req, res) => {
  const { role } = req.query; // รับ parameter role (เช่น regulator, policy) เพื่อกรองข้อมูล

  try {
    // 1. ดึง Principles ทั้งหมด มาเป็นหัวตาราง (แกน X)
    const principlesQuery = await db.query(
      "SELECT id, name FROM principles ORDER BY id ASC",
    );
    const principles = principlesQuery.rows;

    // 2. ดึง Components (กรองตาม role) มาเป็นแถว (แกน Y)
    let componentsQuery;
    let queryParams = [];

    if (role && role !== "all") {
      componentsQuery = await db.query(
        "SELECT id, title, max_maturity_level FROM components WHERE role = $1 ORDER BY id ASC",
        [role],
      );
    } else {
      componentsQuery = await db.query(
        "SELECT id, role, title, max_maturity_level FROM components ORDER BY role ASC, id ASC",
      );
    }
    const components = componentsQuery.rows;

    // 3. ดึงความสัมพันธ์ทั้งหมดที่เคยจับคู่ไว้ (ที่เคยติ๊กถูกไว้)
    const mappingQuery = await db.query(
      "SELECT component_id, principle_id FROM component_principles",
    );
    const mappings = mappingQuery.rows;

    // 4. ส่งข้อมูลกลับไปให้หน้าบ้านประกอบร่าง
    res.json({
      success: true,
      data: {
        principles,
        components,
        mappings, // ส่งเป็น Array [ {component_id: 'ERM01', principle_id: 'P01'}, ... ]
      },
    });
  } catch (error) {
    console.error("Get Mapping Matrix Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลผังการประเมิน",
    });
  }
};

// 2. บันทึกการจับคู่ (เมื่อแอดมินกดปุ่ม Save)
exports.saveMappingMatrix = async (req, res) => {
  // รับข้อมูลการติ๊กถูกทั้งหมดของ Role นั้นๆ มาเป็น Array
  // รูปแบบ: { role: 'regulator', mappings: [ {component_id: 'ERM01', principle_id: 'P01'}, ... ] }
  const { role, mappings } = req.body;

  if (!role || !mappings || !Array.isArray(mappings)) {
    return res
      .status(400)
      .json({ success: false, message: "ข้อมูลที่ส่งมาไม่ถูกต้อง" });
  }

  try {
    await db.query("BEGIN"); // เริ่ม Transaction เพื่อความปลอดภัยของฐานข้อมูล

    // 1. ลบความสัมพันธ์ "เดิม" ของ Components ในกลุ่ม Role นี้ออกให้หมดก่อน
    // (เทคนิคนี้ง่ายกว่าการมานั่งหาว่าแอดมินติ๊กเอาอันไหนเข้า อันไหนออก)
    await db.query(
      `DELETE FROM component_principles 
       WHERE component_id IN (SELECT id FROM components WHERE role = $1)`,
      [role],
    );

    // 2. Insert ความสัมพันธ์ "ใหม่" ทั้งหมดที่แอดมินติ๊กเข้ามา
    if (mappings.length > 0) {
      // สร้าง SQL Command แบบ Bulk Insert เช่น INSERT INTO (...) VALUES ($1, $2), ($3, $4)
      const values = [];
      const queryParams = [];
      let paramIndex = 1;

      mappings.forEach((map) => {
        values.push(`($${paramIndex}, $${paramIndex + 1})`);
        queryParams.push(map.component_id, map.principle_id);
        paramIndex += 2;
      });

      const insertQuery = `INSERT INTO component_principles (component_id, principle_id) VALUES ${values.join(", ")}`;
      await db.query(insertQuery, queryParams);
    }

    await db.query("COMMIT"); // ยืนยันการบันทึก
    res.json({ success: true, message: "บันทึกผังการประเมินสำเร็จ" });
  } catch (error) {
    await db.query("ROLLBACK"); // ถ้ายกเลิก หรือ Error ให้ย้อนกลับข้อมูลทั้งหมด
    console.error("Save Mapping Matrix Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกข้อมูล" });
  }
};

exports.getGuideline = async (req, res) => {
  const { user_type, level_id } = req.query; // เปลี่ยนเป็น user_type

  if (!user_type || level_id === undefined) {
    return res
      .status(400)
      .json({ success: false, message: "กรุณาระบุ User Type และ Level" });
  }

  try {
    const result = await db.query(
      "SELECT * FROM evaluation_guidelines WHERE user_type = $1 AND level_id = $2",
      [user_type, parseInt(level_id)],
    );

    // ถ้ายังไม่มีข้อมูล ส่งค่าว่างกลับไปให้ฟอร์มหน้าบ้าน
    if (result.rows.length === 0) {
      return res.json({ success: true, data: null });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Get Guideline Error:", error);
    res.status(500).json({ success: false, message: "ดึงข้อมูลผิดพลาด" });
  }
};

// 2. บันทึกข้อมูล Guideline (Upsert - มีแล้วแก้, ไม่มีให้เพิ่ม)
exports.saveGuideline = async (req, res) => {
  const {
    user_type,
    level_id,
    analysis,
    strengths,
    gaps,
    risks,
    recommendations,
    roadmap,
  } = req.body; // เปลี่ยนเป็น user_type

  if (!user_type || level_id === undefined) {
    return res
      .status(400)
      .json({ success: false, message: "ข้อมูลไม่ครบถ้วน" });
  }

  try {
    const upsertQuery = `
      INSERT INTO evaluation_guidelines (user_type, level_id, analysis, strengths, gaps, risks, recommendations, roadmap)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (user_type, level_id) 
      DO UPDATE SET
        analysis = EXCLUDED.analysis,
        strengths = EXCLUDED.strengths,
        gaps = EXCLUDED.gaps,
        risks = EXCLUDED.risks,
        recommendations = EXCLUDED.recommendations,
        roadmap = EXCLUDED.roadmap
      RETURNING id;
    `;

    await db.query(upsertQuery, [
      user_type,
      parseInt(level_id),
      analysis,
      strengths,
      gaps,
      risks,
      recommendations,
      roadmap,
    ]);

    res.json({ success: true, message: "บันทึกแนวทางการพัฒนาสำเร็จ" });
  } catch (error) {
    console.error("Save Guideline Error:", error);
    res.status(500).json({ success: false, message: "บันทึกข้อมูลผิดพลาด" });
  }
};

exports.getAllGuidelines = async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM evaluation_guidelines ORDER BY user_type ASC, level_id ASC",
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Get All Guidelines Error:", error);
    res.status(500).json({ success: false, message: "ดึงข้อมูลผิดพลาด" });
  }
};

// 4. ลบข้อมูล Guideline
exports.deleteGuideline = async (req, res) => {
  const { id } = req.params;

  try {
    const deleteQuery = await db.query(
      "DELETE FROM evaluation_guidelines WHERE id = $1 RETURNING id",
      [id],
    );

    if (deleteQuery.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลที่ต้องการลบ" });
    }

    res.json({ success: true, message: "ลบข้อมูลสำเร็จ" });
  } catch (error) {
    console.error("Delete Guideline Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการลบข้อมูล" });
  }
};

exports.getChapters = async (req, res) => {
  try {
    const query = `
      SELECT 
        c.id, 
        c.title, 
        c.target_group AS "targetGroup", 
        c.status,
        c.passing_percentage AS "passingPercentage",
        COUNT(q.id) AS "questionCount"
      FROM chapters c
      LEFT JOIN questions q ON c.id = q.chapter_id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `;
    const result = await db.query(query);

    const formattedChapters = result.rows.map((row) => ({
      id: `CH-${row.id.toString().padStart(2, "0")}`,
      rawId: row.id,
      title: row.title,
      targetRole: `กลุ่มที่ ${row.targetGroup}`,
      status: row.status,
      passingPercentage: row.passingPercentage,
      questionCount: parseInt(row.questionCount),
    }));

    res.status(200).json({
      success: true,
      message: "ดึงข้อมูลบทเรียนสำเร็จ",
      data: { chapters: formattedChapters },
    });
  } catch (error) {
    console.error("Get Chapters Error:", error);
    res
      .status(500)
      .json({ success: false, message: "ไม่สามารถดึงข้อมูลบทเรียนได้" });
  }
};

// --- CREATE CHAPTER (เพิ่มบทเรียนและข้อสอบใหม่) ---
exports.createChapter = async (req, res) => {
  let client;
  try {
    client = await db.getClient();
    await client.query("BEGIN");

    // เพิ่มการรับค่า passingPercentage จากหน้าบ้าน
    const {
      title,
      targetRole,
      status,
      videoUrl,
      questions,
      passingPercentage,
    } = req.body;

    let targetGroup = 1;
    if (targetRole === "Group 2") targetGroup = 2;
    else if (targetRole === "Group 3") targetGroup = 3;

    // บันทึกค่า passing_percentage ลงฐานข้อมูล (ถ้าไม่ส่งมาให้ใช้ค่า default 80)
    const insertChapterQuery = `
      INSERT INTO chapters (title, target_group, video_url, status, passing_percentage)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `;
    const chapterResult = await client.query(insertChapterQuery, [
      title,
      targetGroup,
      videoUrl,
      status,
      passingPercentage ? parseInt(passingPercentage) : 80,
    ]);
    const newChapterId = chapterResult.rows[0].id;

    if (questions && questions.length > 0) {
      const insertQuestionQuery = `
        INSERT INTO questions (chapter_id, question_text, options, correct_answer)
        VALUES ($1, $2, $3, $4)
      `;
      for (let q of questions) {
        await client.query(insertQuestionQuery, [
          newChapterId,
          q.questionText,
          JSON.stringify(q.options),
          q.correctAnswer,
        ]);
      }
    }

    await client.query("COMMIT");
    res.status(201).json({
      success: true,
      message: "บันทึกบทเรียนและข้อสอบเรียบร้อยแล้ว",
      data: { chapterId: newChapterId },
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error("Create Chapter Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกข้อมูล" });
  } finally {
    if (client) client.release();
  }
};

// --- GET CHAPTER BY ID (ดึงบทเรียนตาม ID เพื่อแก้ไข) ---
exports.getChapterById = async (req, res) => {
  try {
    const { id } = req.params;

    const chapterResult = await db.query(
      "SELECT * FROM chapters WHERE id = $1",
      [id],
    );
    if (chapterResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบบทเรียนที่ต้องการ" });
    }
    const chapter = chapterResult.rows[0];

    const questionsResult = await db.query(
      "SELECT * FROM questions WHERE chapter_id = $1 ORDER BY id ASC",
      [id],
    );

    const questions = questionsResult.rows.map((q) => ({
      id: q.id,
      questionText: q.question_text,
      options: q.options,
      correctAnswer: q.correct_answer,
    }));

    let targetRole = "Group 1";
    if (chapter.target_group === 2) targetRole = "Group 2";
    else if (chapter.target_group === 3) targetRole = "Group 3";

    res.status(200).json({
      success: true,
      data: {
        title: chapter.title,
        targetRole: targetRole,
        status: chapter.status,
        videoUrl: chapter.video_url,
        passingPercentage: chapter.passing_percentage || 80, // ส่งเกณฑ์กลับไปแสดงผล
        questions: questions,
      },
    });
  } catch (error) {
    console.error("Get Chapter By ID Error:", error);
    res
      .status(500)
      .json({ success: false, message: "ไม่สามารถดึงข้อมูลบทเรียนได้" });
  }
};

// --- UPDATE CHAPTER (บันทึกการแก้ไขข้อมูล) ---
exports.updateChapter = async (req, res) => {
  let client;
  try {
    const { id } = req.params;
    // รับค่า passingPercentage เพิ่มเข้ามาจาก Payload
    const {
      title,
      targetRole,
      status,
      videoUrl,
      questions,
      passingPercentage,
    } = req.body;

    let targetGroup = 1;
    if (targetRole === "Group 2") targetGroup = 2;
    else if (targetRole === "Group 3") targetGroup = 3;

    client = await db.getClient();
    await client.query("BEGIN");

    // 1. อัปเดตข้อมูลบทเรียนหลักรวมถึงเกณฑ์ผ่านคะแนน
    const updateChapterQuery = `
      UPDATE chapters 
      SET title = $1, target_group = $2, video_url = $3, status = $4, passing_percentage = $5, updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
    `;
    await client.query(updateChapterQuery, [
      title,
      targetGroup,
      videoUrl,
      status,
      passingPercentage ? parseInt(passingPercentage) : 80,
      id,
    ]);

    // 2. ลบข้อสอบชุดเก่าทิ้งทั้งหมด
    await client.query("DELETE FROM questions WHERE chapter_id = $1", [id]);

    // 3. Insert ข้อสอบชุดใหม่เข้าไปแทน
    if (questions && questions.length > 0) {
      const insertQuestionQuery = `
        INSERT INTO questions (chapter_id, question_text, options, correct_answer)
        VALUES ($1, $2, $3, $4)
      `;
      for (let q of questions) {
        await client.query(insertQuestionQuery, [
          id,
          q.questionText,
          JSON.stringify(q.options),
          q.correctAnswer,
        ]);
      }
    }

    await client.query("COMMIT");
    res
      .status(200)
      .json({ success: true, message: "อัปเดตข้อมูลเรียบร้อยแล้ว" });
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    console.error("Update Chapter Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการอัปเดตข้อมูล" });
  } finally {
    if (client) client.release();
  }
};

// --- DELETE CHAPTER (ลบบทเรียน - โค้ดเดิมคงไว้) ---
exports.deleteChapter = async (req, res) => {
  try {
    const { id } = req.params;
    const deleteQuery = "DELETE FROM chapters WHERE id = $1 RETURNING id";
    const result = await db.query(deleteQuery, [id]);

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบบทเรียนที่ต้องการลบ" });
    }
    res
      .status(200)
      .json({ success: true, message: "ลบบทเรียนและข้อสอบเรียบร้อยแล้ว" });
  } catch (error) {
    console.error("Delete Chapter Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการลบข้อมูล" });
  }
};

// ==========================================
// ฟังก์ชันใหม่: ระบบดูรายชื่อผู้ได้รับใบประกาศนียบัตร (Certificates)
// ==========================================

exports.getCertificates = async (req, res) => {
  try {
    const query = `
      SELECT 
        c.id AS "certId",
        c.course_group AS "courseGroup",
        c.issued_at AS "issuedAt",
        p.first_name_th || ' ' || p.last_name_th AS "userName",
        p.email AS "userEmail",
        o.org_name AS "orgName" -- แก้เป็น org_name ตามโครงสร้าง DB จริง
      FROM certificates c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN profiles p ON u.id = p.user_id
      LEFT JOIN organizations o ON u.organization_id = o.id
      ORDER BY c.issued_at DESC
    `;
    const result = await db.query(query);
    res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Get Certificates Error:", error);
    res.status(500).json({
      success: false,
      message: "ไม่สามารถดึงข้อมูลประวัติการออกใบเซอร์ได้",
    });
  }
};

// 2. ลบ/เพิกถอนประวัติใบประกาศนียบัตร
exports.deleteCertificate = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      "DELETE FROM certificates WHERE id = $1 RETURNING id",
      [id],
    );
    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบรายการใบประกาศฯ ที่ต้องการลบ" });
    }
    res
      .status(200)
      .json({ success: true, message: "ลบประวัติใบประกาศนียบัตรสำเร็จ" });
  } catch (error) {
    console.error("Delete Certificate Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการลบข้อมูล" });
  }
};

// ==========================================
// ฟังก์ชันใหม่: จัดการแม่แบบใบประกาศนียบัตร (Certificate Settings)
// ==========================================

// 1. ดึงข้อมูลการตั้งค่าแม่แบบใบประกาศฯ ตามกลุ่มหลักสูตร
exports.getCertificateSettings = async (req, res) => {
  try {
    const { groupId } = req.params;
    const result = await db.query(
      "SELECT * FROM certificate_settings WHERE course_group = $1",
      [parseInt(groupId)],
    );

    // ถ้ายังไม่มีการตั้งค่า ส่งค่าว่างกลับไป
    if (result.rows.length === 0) {
      return res.status(200).json({ success: true, data: null });
    }

    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Get Certificate Settings Error:", error);
    res.status(500).json({
      success: false,
      message: "ไม่สามารถดึงข้อมูลการตั้งค่าใบประกาศฯ ได้",
    });
  }
};

exports.saveCertificateSettings = async (req, res) => {
  try {
    const {
      course_group,
      course_name, // <--- 1. เพิ่มตัวแปรนี้
      background_url,
      logo_url,
      signatory_name,
      signatory_position,
      signature_url,
    } = req.body;

    if (!course_group) {
      return res
        .status(400)
        .json({ success: false, message: "กรุณาระบุกลุ่มหลักสูตร" });
    }

    const upsertQuery = `
      INSERT INTO certificate_settings 
        (course_group, course_name, background_url, logo_url, signatory_name, signatory_position, signature_url) 
      VALUES ($1, $2, $3, $4, $5, $6, $7)  -- <--- 2. เพิ่ม $2 และขยับเลขที่เหลือ
      ON CONFLICT (course_group)
      DO UPDATE SET
        course_name = EXCLUDED.course_name, -- <--- 3. ให้มันอัปเดตค่าได้
        background_url = EXCLUDED.background_url,
        logo_url = EXCLUDED.logo_url,
        signatory_name = EXCLUDED.signatory_name,
        signatory_position = EXCLUDED.signatory_position,
        signature_url = EXCLUDED.signature_url,
        updated_at = CURRENT_TIMESTAMP
    `;

    await db.query(upsertQuery, [
      parseInt(course_group),
      course_name, // <--- 4. ใส่ค่าส่งไปใน Array
      background_url,
      logo_url,
      signatory_name,
      signatory_position,
      signature_url,
    ]);

    res
      .status(200)
      .json({ success: true, message: "บันทึกแม่แบบใบประกาศนียบัตรสำเร็จ" });
  } catch (error) {
    console.error("Save Certificate Settings Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการบันทึกข้อมูลแม่แบบ",
    });
  }
};

exports.deleteOrganization = async (req, res) => {
  try {
    const { id } = req.params;

    // ลบข้อมูลจากฐานข้อมูล (สมมติว่าตารางชื่อ organizations)
    // หากมีการเชื่อมโยง Foreign Key ไว้ แนะนำให้ตั้ง ON DELETE CASCADE ที่ตารางลูกด้วย
    const result = await db.query(
      "DELETE FROM organizations WHERE org_code = $1 RETURNING *",
      [id],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูลหน่วยงานที่ต้องการลบในระบบ",
      });
    }

    res.status(200).json({
      success: true,
      message: "ลบข้อมูลหน่วยงานสำเร็จ",
    });
  } catch (error) {
    console.error("Delete Organization Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดทางเซิร์ฟเวอร์ ไม่สามารถลบข้อมูลได้",
    });
  }
};
