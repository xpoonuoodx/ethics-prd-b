const fs = require("fs");
const path = require("path");
const db = require("../db");
const { generateCertNumber } = require("../utils/certNumber");
const { getTargetGroupFromUserType } = require("../utils/targetGroup");
const { getAppSettings } = require("../utils/appSettings");
const bcrypt = require("bcryptjs");
const {
  isValidUsername,
  isValidPassword,
  isValidPhone,
} = require("../utils/validators");
const { UPLOAD_DIR } = require("../utils/uploadMiddleware");

// กลุ่มอุตสาหกรรมของหน่วยงาน
const VALID_SECTORS = [
  "government",
  "finance",
  "healthcare",
  "education",
  "industry",
  "commerce",
  "other",
];

// 1. ดึงข้อมูล Dashboard
exports.getDashboard = async (req, res) => {
  try {
    const userId = req.user.account_id || req.user.id;
    const userQuery = await db.query(
      "SELECT u.organization_id, o.org_name FROM users u LEFT JOIN organizations o ON u.organization_id = o.id WHERE u.id = $1",
      [userId],
    );

    if (userQuery.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลผู้ใช้งาน" });
    }

    const orgId = userQuery.rows[0].organization_id;
    const orgName = userQuery.rows[0].org_name;

    const totalUsersRes = await db.query(
      "SELECT COUNT(*) FROM users WHERE organization_id = $1 AND role != 'admin'",
      [orgId],
    );

    // สถานะโครงการคำนวณสดจาก "สมาชิกในโครงการทำแบบประเมินตนเองครบทุกคนหรือยัง"
    // ไม่ได้อ่านจากคอลัมน์ status ที่ถูกตั้งค่าตายตัวตอนสร้างโครงการ (ดู addProject)
    const projectsStatusRes = await db.query(
      `SELECT
        p.id,
        (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) as total_members,
        (SELECT COUNT(*) FROM project_members pm
           WHERE pm.project_id = p.id
           AND EXISTS (SELECT 1 FROM user_tools_history uth WHERE uth.user_id = pm.user_id)
        ) as completed_members
       FROM projects p
       WHERE p.organization_id = $1`,
      [orgId],
    );

    let pendingCount = 0;
    let inProgressCount = 0;
    let completedCount = 0;
    projectsStatusRes.rows.forEach((row) => {
      const total = parseInt(row.total_members) || 0;
      const completed = parseInt(row.completed_members) || 0;
      if (total > 0 && completed === total) completedCount++;
      else if (completed > 0) inProgressCount++;
      else pendingCount++;
    });

    const chartData = [
      { name: "Pending", projects: pendingCount, color: "#f59e0b" },
      { name: "In Progress", projects: inProgressCount, color: "#3b82f6" },
      { name: "Completed", projects: completedCount, color: "#10b981" },
    ].filter((c) => c.projects > 0);

    const usersRes = await db.query(
      `
      SELECT u.id, u.username, u.role, p.first_name_th || ' ' || p.last_name_th AS name, u.created_at
      FROM users u LEFT JOIN profiles p ON u.id = p.user_id
      WHERE u.organization_id = $1 AND u.role = 'user' ORDER BY u.created_at DESC LIMIT 5
    `,
      [orgId],
    );

    const projectsRes = await db.query(
      `
      SELECT
        p.id, p.project_name, p.created_at, p.progress,
        pr.first_name_th || ' ' || pr.last_name_th AS manager,
        (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) as total_members,
        (SELECT COUNT(*) FROM project_members pm
           WHERE pm.project_id = p.id
           AND EXISTS (SELECT 1 FROM user_tools_history uth WHERE uth.user_id = pm.user_id)
        ) as completed_members
      FROM projects p LEFT JOIN users u ON p.created_by = u.id LEFT JOIN profiles pr ON u.id = pr.user_id
      WHERE p.organization_id = $1 ORDER BY p.created_at DESC LIMIT 5
    `,
      [orgId],
    );
    const recentProjects = projectsRes.rows.map((row) => {
      const total = parseInt(row.total_members) || 0;
      const completed = parseInt(row.completed_members) || 0;
      let status = "Pending";
      if (total > 0 && completed === total) status = "Completed";
      else if (completed > 0) status = "In Progress";
      return { ...row, status, total_members: total, completed_members: completed };
    });

    // คะแนนประเมินจริยธรรม AI เฉลี่ยรายหลักการ คำนวณจากผลประเมินตนเอง (user_tools_history)
    // ของ "บุคลากรในหน่วยงานนี้เท่านั้น" (กรองด้วย organization_id ของ regulator ที่ login อยู่)
    const radarRes = await db.query(
      `
      SELECT
        p->>'id' as principle_id,
        p->>'name' as principle_name,
        AVG((uth.maturity_id::float / max_level.max_id) * 100) as avg_score
      FROM user_tools_history uth
      JOIN users u ON uth.user_id = u.id
      CROSS JOIN LATERAL jsonb_array_elements(uth.result_data->'principles') AS p
      CROSS JOIN (SELECT MAX(level_id) as max_id FROM maturity_levels WHERE is_active = true) max_level
      WHERE u.organization_id = $1
      GROUP BY p->>'id', p->>'name'
      ORDER BY p->>'id' ASC
    `,
      [orgId],
    );
    const ethicsRadar = radarRes.rows.map((row) => ({
      subject: row.principle_name,
      score: Math.round(parseFloat(row.avg_score)),
      fullMark: 100,
    }));

    res.json({
      success: true,
      data: {
        orgName: orgName,
        stats: {
          totalProjects: projectsStatusRes.rows.length,
          totalUsers: parseInt(totalUsersRes.rows[0].count) || 0,
          pendingProjects: pendingCount,
          activeProjects: inProgressCount,
        },
        chartData: chartData,
        ethicsRadar: ethicsRadar,
        recentUsers: usersRes.rows,
        recentProjects: recentProjects,
      },
    });
  } catch (error) {
    console.error("Get Regulator Dashboard Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// 2. ดึงรายชื่อบุคลากรในหน่วยงาน
exports.getUsers = async (req, res) => {
  try {
    const userId = req.user.account_id || req.user.id;
    const orgQuery = await db.query(
      "SELECT organization_id FROM users WHERE id = $1",
      [userId],
    );
    const orgId = orgQuery.rows[0].organization_id;

    // เพิ่ม u.user_type เข้ามาในการดึงข้อมูล
    const result = await db.query(
      `
      SELECT 
        u.id, 
        u.username, 
        u.role,
        u.user_type, 
        'Active' AS status,
        p.first_name_th || ' ' || p.last_name_th AS name,
        p.email
      FROM users u
      LEFT JOIN profiles p ON u.id = p.user_id
      WHERE u.organization_id = $1 AND u.role = 'user'
      ORDER BY u.created_at DESC
    `,
      [orgId],
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Get Users Error:", error);
    res
      .status(500)
      .json({ success: false, message: "ดึงข้อมูลผู้ใช้งานผิดพลาด" });
  }
};

// 3. เพิ่มบุคลากรใหม่ (รองรับ user_type)
exports.addUser = async (req, res) => {
  // รับค่า user_type เพิ่มเติม
  const { username, password, name, email, user_type } = req.body;

  if (!isValidUsername(username)) {
    return res.status(400).json({
      success: false,
      message: "ชื่อผู้ใช้งานต้องเป็นภาษาอังกฤษ ตัวเลข หรือ . _ - เท่านั้น (ห้ามใช้ภาษาไทย)",
    });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({
      success: false,
      message: "รหัสผ่านต้องเป็นภาษาอังกฤษเท่านั้น (ห้ามใช้ภาษาไทย)",
    });
  }

  try {
    const userId = req.user.account_id || req.user.id;
    const orgQuery = await db.query(
      "SELECT organization_id FROM users WHERE id = $1",
      [userId],
    );
    const orgId = orgQuery.rows[0].organization_id;

    await db.query("BEGIN");

    // เช็ค Username ซ้ำ
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

    const checkEmail = await db.query(
      "SELECT id FROM profiles WHERE email = $1",
      [email],
    );
    if (checkEmail.rows.length > 0) {
      await db.query("ROLLBACK");
      return res
        .status(400)
        .json({ success: false, message: "อีเมลนี้ถูกใช้งานแล้ว" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // บันทึกตาราง users โดยใส่ user_type เข้าไปด้วย
    const insertUser = await db.query(
      `INSERT INTO users (username, password, role, organization_id, user_type) VALUES ($1, $2, 'user', $3, $4) RETURNING id`,
      [username, hashedPassword, orgId, user_type],
    );

    const newUserId = insertUser.rows[0].id;
    const nameParts = name.trim().split(" ");
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    await db.query(
      `INSERT INTO profiles (user_id, first_name_th, last_name_th, email, is_verified) VALUES ($1, $2, $3, $4, true)`,
      [newUserId, firstName, lastName, email],
    );

    await db.query("COMMIT");
    res
      .status(201)
      .json({ success: true, message: "เพิ่มบัญชีผู้ใช้งานสำเร็จ" });
  } catch (error) {
    await db.query("ROLLBACK");
    console.error("Add User Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกบัญชี" });
  }
};

// 4. ลบบุคลากร
exports.deleteUser = async (req, res) => {
  const { id } = req.params;
  try {
    const userId = req.user.account_id || req.user.id;
    const orgQuery = await db.query(
      "SELECT organization_id FROM users WHERE id = $1",
      [userId],
    );
    const orgId = orgQuery.rows[0].organization_id;

    const userToDelete = await db.query(
      "SELECT organization_id FROM users WHERE id = $1",
      [id],
    );
    if (
      userToDelete.rows.length === 0 ||
      userToDelete.rows[0].organization_id !== orgId
    ) {
      return res
        .status(403)
        .json({ success: false, message: "ไม่มีสิทธิ์ลบผู้ใช้งานนี้" });
    }

    await db.query("DELETE FROM users WHERE id = $1", [id]);
    res.json({ success: true, message: "ลบผู้ใช้งานสำเร็จ" });
  } catch (error) {
    console.error("Delete User Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการลบข้อมูล" });
  }
};

exports.viewUser = async (req, res) => {
  try {
    const { id } = req.params;

    // เช็คว่า user เป้าหมายอยู่หน่วยงานเดียวกับ regulator ที่ login อยู่หรือไม่ (กัน IDOR ข้ามหน่วยงาน)
    const userId = req.user.account_id || req.user.id;
    const orgQuery = await db.query(
      "SELECT organization_id FROM users WHERE id = $1",
      [userId],
    );
    const orgId = orgQuery.rows[0].organization_id;

    const targetOrgQuery = await db.query(
      "SELECT organization_id FROM users WHERE id = $1",
      [id],
    );
    if (
      targetOrgQuery.rows.length === 0 ||
      targetOrgQuery.rows[0].organization_id !== orgId
    ) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบผู้ใช้งานนี้ในระบบ" });
    }

    const query = `
      SELECT 
        u.id, 
        u.username,
        p.email,
        p.first_name_th || ' ' || p.last_name_th AS name,
        u.user_type,
        o.org_name
      FROM users u
      LEFT JOIN profiles p ON u.id = p.user_id
      LEFT JOIN organizations o ON u.organization_id = o.id
      WHERE u.id = $1
    `;
    const result = await db.query(query, [id]);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบผู้ใช้งานนี้ในระบบ" });
    }

    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("View User Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการโหลดข้อมูลผู้ใช้" });
  }
};

// ==========================================
// ส่วนที่เพิ่มใหม่: แก้ไขชื่อและอีเมล สำหรับ Regulator
// ==========================================
exports.editUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email } = req.body;

    if (!name || name.trim() === "" || !email || email.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุชื่อ-นามสกุล และ อีเมลให้ครบถ้วน",
      });
    }

    // เช็คว่า user เป้าหมายอยู่หน่วยงานเดียวกับ regulator ที่ login อยู่หรือไม่ (กัน IDOR ข้ามหน่วยงาน)
    const currentUserId = req.user.account_id || req.user.id;
    const orgQuery = await db.query(
      "SELECT organization_id FROM users WHERE id = $1",
      [currentUserId],
    );
    const orgId = orgQuery.rows[0].organization_id;

    const targetOrgQuery = await db.query(
      "SELECT organization_id FROM users WHERE id = $1",
      [id],
    );
    if (
      targetOrgQuery.rows.length === 0 ||
      targetOrgQuery.rows[0].organization_id !== orgId
    ) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบผู้ใช้งานนี้ในระบบ" });
    }

    // ทำการแยกชื่อกับนามสกุลด้วยช่องว่าง
    const nameParts = name.trim().split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

    const updateQuery = `
      UPDATE profiles 
      SET first_name_th = $1, last_name_th = $2, email = $3, updated_at = CURRENT_TIMESTAMP 
      WHERE user_id = $4
      RETURNING *
    `;
    const result = await db.query(updateQuery, [
      firstName,
      lastName,
      email,
      id,
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูลโปรไฟล์ผู้ใช้งานเพื่อทำการอัปเดต",
      });
    }

    res.status(200).json({ success: true, message: "อัปเดตข้อมูลสำเร็จ" });
  } catch (error) {
    console.error("Edit User Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดจากเซิร์ฟเวอร์ ไม่สามารถแก้ไขข้อมูลได้",
    });
  }
};

// ==========================================
// ส่วนของการจัดการโครงการ (Projects)
// ==========================================

// 5. ดึงข้อมูลโครงการทั้งหมดในหน่วยงาน
exports.getProjects = async (req, res) => {
  try {
    const userId = req.user.account_id || req.user.id;
    const orgQuery = await db.query(
      "SELECT organization_id FROM users WHERE id = $1",
      [userId],
    );
    const orgId = orgQuery.rows[0].organization_id;

    const result = await db.query(
      `
      SELECT
        p.id,
        p.project_code,
        p.project_name,
        p.progress,
        p.created_at,
        (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) as total_members,
        (SELECT COUNT(*) FROM project_members pm
           WHERE pm.project_id = p.id
           AND EXISTS (SELECT 1 FROM user_tools_history uth WHERE uth.user_id = pm.user_id)
        ) as completed_members,
        pr.first_name_th || ' ' || pr.last_name_th AS manager
      FROM projects p
      LEFT JOIN users u ON p.created_by = u.id
      LEFT JOIN profiles pr ON u.id = pr.user_id
      WHERE p.organization_id = $1
      ORDER BY p.created_at DESC
    `,
      [orgId],
    );

    // สถานะโครงการคำนวณสดจากจำนวนสมาชิกที่ทำแบบประเมินตนเองแล้วเทียบกับสมาชิกทั้งหมด
    const projects = result.rows.map((row) => {
      const total = parseInt(row.total_members) || 0;
      const completed = parseInt(row.completed_members) || 0;
      let status = "Pending";
      if (total > 0 && completed === total) status = "Completed";
      else if (completed > 0) status = "In Progress";
      return {
        ...row,
        status,
        total_members: total,
        completed_members: completed,
      };
    });

    res.json({ success: true, data: projects });
  } catch (error) {
    console.error("Get Projects Error:", error);
    res
      .status(500)
      .json({ success: false, message: "ดึงข้อมูลโครงการผิดพลาด" });
  }
};

// 6. สร้างโครงการใหม่
exports.addProject = async (req, res) => {
  const { project_code, project_name, project_type, ai_objective, accountable_owner } =
    req.body;

  try {
    const userId = req.user.account_id || req.user.id;
    const orgQuery = await db.query(
      "SELECT organization_id FROM users WHERE id = $1",
      [userId],
    );
    const orgId = orgQuery.rows[0].organization_id;

    const checkCode = await db.query(
      "SELECT id FROM projects WHERE project_code = $1",
      [project_code],
    );
    if (checkCode.rows.length > 0) {
      return res
        .status(400)
        .json({ success: false, message: "รหัสโครงการนี้ถูกใช้งานแล้ว" });
    }

    await db.query(
      `INSERT INTO projects (project_code, project_name, organization_id, created_by, progress, status, project_type, ai_objective, accountable_owner)
       VALUES ($1, $2, $3, $4, 0, 'Pending', $5, $6, $7)`,
      [
        project_code,
        project_name,
        orgId,
        userId,
        project_type || null,
        ai_objective || null,
        accountable_owner || null,
      ],
    );

    res.status(201).json({ success: true, message: "สร้างโครงการสำเร็จ" });
  } catch (error) {
    console.error("Add Project Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการสร้างโครงการ" });
  }
};

// 7. ลบโครงการ
exports.deleteProject = async (req, res) => {
  const { id } = req.params;
  try {
    const userId = req.user.account_id || req.user.id;
    const orgQuery = await db.query(
      "SELECT organization_id FROM users WHERE id = $1",
      [userId],
    );
    const orgId = orgQuery.rows[0].organization_id;

    const checkProject = await db.query(
      "SELECT organization_id FROM projects WHERE id = $1",
      [id],
    );
    if (
      checkProject.rows.length === 0 ||
      checkProject.rows[0].organization_id !== orgId
    ) {
      return res
        .status(403)
        .json({ success: false, message: "ไม่มีสิทธิ์ลบโครงการนี้" });
    }

    await db.query("DELETE FROM projects WHERE id = $1", [id]);
    res.json({ success: true, message: "ลบโครงการสำเร็จ" });
  } catch (error) {
    console.error("Delete Project Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการลบโครงการ" });
  }
};

// 8. เพิ่มบุคลากรเข้าโครงการ
exports.assignUserToProject = async (req, res) => {
  const { project_id, user_id } = req.body;
  try {
    const currentUserId = req.user.account_id || req.user.id;
    const orgQuery = await db.query(
      "SELECT organization_id FROM users WHERE id = $1",
      [currentUserId],
    );
    const orgId = orgQuery.rows[0].organization_id;

    const checkProject = await db.query(
      "SELECT id FROM projects WHERE id = $1 AND organization_id = $2",
      [project_id, orgId],
    );
    if (checkProject.rows.length === 0) {
      return res
        .status(403)
        .json({ success: false, message: "ไม่มีสิทธิ์จัดการโครงการนี้" });
    }

    const checkExist = await db.query(
      "SELECT * FROM project_members WHERE project_id = $1 AND user_id = $2",
      [project_id, user_id],
    );
    if (checkExist.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "บุคลากรท่านนี้อยู่ในโครงการอยู่แล้ว",
      });
    }

    await db.query(
      "INSERT INTO project_members (project_id, user_id) VALUES ($1, $2)",
      [project_id, user_id],
    );

    res.json({ success: true, message: "เพิ่มบุคลากรเข้าโครงการสำเร็จ" });
  } catch (error) {
    console.error("Assign User Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการเพิ่มบุคลากร" });
  }
};

// 8a. แก้ไขข้อมูลโครงการ
exports.editProject = async (req, res) => {
  const { id } = req.params;
  const { project_name, project_type, ai_objective, accountable_owner } = req.body;

  if (!project_name || project_name.trim() === "") {
    return res
      .status(400)
      .json({ success: false, message: "กรุณาระบุชื่อโครงการ" });
  }

  try {
    const userId = req.user.account_id || req.user.id;
    const orgQuery = await db.query(
      "SELECT organization_id FROM users WHERE id = $1",
      [userId],
    );
    const orgId = orgQuery.rows[0].organization_id;

    const checkProject = await db.query(
      "SELECT organization_id FROM projects WHERE id = $1",
      [id],
    );
    if (
      checkProject.rows.length === 0 ||
      checkProject.rows[0].organization_id !== orgId
    ) {
      return res
        .status(403)
        .json({ success: false, message: "ไม่มีสิทธิ์แก้ไขโครงการนี้" });
    }

    await db.query(
      `UPDATE projects
       SET project_name = $1, project_type = $2, ai_objective = $3, accountable_owner = $4
       WHERE id = $5`,
      [
        project_name.trim(),
        project_type || null,
        ai_objective || null,
        accountable_owner || null,
        id,
      ],
    );

    res.json({ success: true, message: "แก้ไขข้อมูลโครงการสำเร็จ" });
  } catch (error) {
    console.error("Edit Project Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการแก้ไขโครงการ" });
  }
};

// 8b. ถอดบุคลากรออกจากโครงการ
exports.removeProjectMember = async (req, res) => {
  const { id } = req.params; // project id
  const { user_id } = req.body;

  if (!user_id) {
    return res
      .status(400)
      .json({ success: false, message: "กรุณาระบุบุคลากรที่ต้องการถอดออก" });
  }

  try {
    const currentUserId = req.user.account_id || req.user.id;
    const orgQuery = await db.query(
      "SELECT organization_id FROM users WHERE id = $1",
      [currentUserId],
    );
    const orgId = orgQuery.rows[0].organization_id;

    const checkProject = await db.query(
      "SELECT id FROM projects WHERE id = $1 AND organization_id = $2",
      [id, orgId],
    );
    if (checkProject.rows.length === 0) {
      return res
        .status(403)
        .json({ success: false, message: "ไม่มีสิทธิ์จัดการโครงการนี้" });
    }

    const deleteResult = await db.query(
      "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 RETURNING project_id",
      [id, user_id],
    );

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบบุคลากรท่านนี้ในโครงการนี้",
      });
    }

    res.json({ success: true, message: "ถอดบุคลากรออกจากโครงการสำเร็จ" });
  } catch (error) {
    console.error("Remove Project Member Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการถอดบุคลากร" });
  }
};

// 9. ดึงข้อมูลรายละเอียดโครงการและบุคลากรภายในโครงการ
exports.viewProject = async (req, res) => {
  const { id } = req.params;

  try {
    const userId = req.user.account_id || req.user.id;
    const orgQuery = await db.query(
      "SELECT organization_id FROM users WHERE id = $1",
      [userId],
    );
    const orgId = orgQuery.rows[0].organization_id;

    const projectResult = await db.query(
      `SELECT
         id, project_code, project_name, progress, created_at,
         project_type, ai_objective, accountable_owner,
         (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = projects.id) as total_members,
         (SELECT COUNT(*) FROM project_members pm
            WHERE pm.project_id = projects.id
            AND EXISTS (SELECT 1 FROM user_tools_history uth WHERE uth.user_id = pm.user_id)
         ) as completed_members
       FROM projects
       WHERE id = $1 AND organization_id = $2`,
      [id, orgId],
    );

    if (projectResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูลโครงการ หรือคุณไม่มีสิทธิ์เข้าถึง",
      });
    }

    const projectRow = projectResult.rows[0];
    const totalMembers = parseInt(projectRow.total_members) || 0;
    const completedMembers = parseInt(projectRow.completed_members) || 0;
    let status = "Pending";
    if (totalMembers > 0 && completedMembers === totalMembers)
      status = "Completed";
    else if (completedMembers > 0) status = "In Progress";

    const projectData = {
      ...projectRow,
      status,
      total_members: totalMembers,
      completed_members: completedMembers,
    };

    // รายชื่อสมาชิก พร้อมสถานะว่าทำแบบประเมินตนเองแล้วหรือยัง (has_assessed)
    const membersResult = await db.query(
      `SELECT
         u.id,
         u.username,
         p.first_name_th || ' ' || p.last_name_th AS name,
         p.email,
         EXISTS (
           SELECT 1 FROM user_tools_history uth WHERE uth.user_id = u.id
         ) as has_assessed
       FROM project_members pm
       JOIN users u ON pm.user_id = u.id
       LEFT JOIN profiles p ON u.id = p.user_id
       WHERE pm.project_id = $1`,
      [id],
    );

    // คะแนนประเมินจริยธรรม AI เฉลี่ยรายหลักการ เฉพาะ "สมาชิกในโครงการนี้เท่านั้น"
    const radarRes = await db.query(
      `
      SELECT
        pri->>'id' as principle_id,
        pri->>'name' as principle_name,
        AVG((uth.maturity_id::float / max_level.max_id) * 100) as avg_score
      FROM user_tools_history uth
      JOIN project_members pm ON pm.user_id = uth.user_id
      CROSS JOIN LATERAL jsonb_array_elements(uth.result_data->'principles') AS pri
      CROSS JOIN (SELECT MAX(level_id) as max_id FROM maturity_levels WHERE is_active = true) max_level
      WHERE pm.project_id = $1
      GROUP BY pri->>'id', pri->>'name'
      ORDER BY pri->>'id' ASC
    `,
      [id],
    );
    const ethicsRadar = radarRes.rows.map((row) => ({
      subject: row.principle_name,
      score: Math.round(parseFloat(row.avg_score)),
      fullMark: 100,
    }));

    res.json({
      success: true,
      data: {
        project: projectData,
        members: membersResult.rows,
        ethicsRadar,
      },
    });
  } catch (error) {
    console.error("View Project Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลโครงการ" });
  }
};

// ==========================================
// สื่อการเรียนรู้และแบบประเมิน สำหรับ Regulator (แยกจาก userControllers เป็น endpoint ของตัวเอง)
// ==========================================

// ดึงรายการสื่อการเรียนรู้ (Classroom)
exports.getRegulatorClassroom = async (req, res) => {
  try {
    const userId = req.params.id;

    // กันไม่ให้ regulator คนอื่นเปลี่ยนเลข id ใน URL แล้วดูห้องเรียนของคนอื่นได้ (IDOR)
    if (parseInt(userId, 10) !== (req.user.account_id || req.user.id)) {
      return res
        .status(403)
        .json({ success: false, message: "ไม่มีสิทธิ์เข้าถึงข้อมูลนี้" });
    }

    // เรียนได้ทุกหลักสูตรไม่ว่าจะเป็น user_type ไหน (การทำข้อสอบเท่านั้นที่ยังจำกัดตาม
    // user_type เดิม ดู getRegulatorTestsList/submitRegulatorTestResult) เลยดึงบทเรียนทุกกลุ่ม
    // มาให้หมด แล้วจัดเป็นชุดหลักสูตรแยกตามกลุ่มไว้ให้หน้าบ้าน render เป็นหัวข้อ ๆ
    const COURSE_INFO = {
      1: {
        courseTitle: "หลักสูตรสำหรับผู้วางนโยบาย (Regulator)",
        courseDesc:
          "เรียนรู้แนวทางการกำกับดูแลและการสร้างนโยบาย AI ที่สอดคล้องกับหลักจริยธรรมระดับชาติ",
      },
      2: {
        courseTitle:
          "หลักสูตรสำหรับนักพัฒนา (Researcher, Developer, Service Provider)",
        courseDesc:
          "เรียนรู้การออกแบบและพัฒนาโมเดล AI ที่มีความโปร่งใส อธิบายได้ และลดความลำเอียง",
      },
      3: {
        courseTitle: "หลักสูตรสำหรับผู้ใช้งานทั่วไป (General User)",
        courseDesc:
          "สร้างความตระหนักรู้และเข้าใจผลกระทบของการใช้งาน AI ในชีวิตประจำวัน",
      },
    };

    const chaptersQuery = `
      SELECT
        c.id AS "chapterId",
        c.title AS "chapterTitle",
        c.target_group AS "targetGroup",
        COALESCE(up.is_passed, false) AS "isPassed",
        up.score AS "userScore",
        (SELECT COUNT(*) FROM questions q WHERE q.chapter_id = c.id) AS "totalQuestions"
      FROM chapters c
      LEFT JOIN user_progress up ON c.id = up.chapter_id AND up.user_id = $1
      WHERE c.status = 'Active'
      ORDER BY c.target_group ASC, c.id ASC
    `;
    const chaptersResult = await db.query(chaptersQuery, [userId]);

    const courses = [1, 2, 3].map((group) => ({
      targetGroup: group,
      ...COURSE_INFO[group],
      chapters: chaptersResult.rows.filter((row) => row.targetGroup === group),
    }));

    res.status(200).json({
      success: true,
      data: { courses },
    });
  } catch (error) {
    console.error("Get Regulator Classroom Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลห้องเรียน",
    });
  }
};

// ดึงข้อมูลบทเรียน 1 บท สำหรับหน้าเรียนวิดีโอ
exports.getRegulatorChapterById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      "SELECT title, video_url, target_group FROM chapters WHERE id = $1",
      [id],
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลบทเรียน" });
    }

    // เรียนดูวิดีโอได้ทุกหลักสูตร แต่ทำข้อสอบได้แค่หลักสูตรของ user_type ตัวเองเท่านั้น
    // เลยต้องบอกหน้าบ้านว่าบทนี้ควรมีปุ่ม "เข้าสู่แบบทดสอบ" ให้กดหรือไม่
    const userId = req.user.account_id || req.user.id;
    const userResult = await db.query(
      "SELECT user_type FROM users WHERE id = $1",
      [userId],
    );
    const ownTargetGroup = getTargetGroupFromUserType(
      userResult.rows[0]?.user_type,
    );

    // ถ้า admin เปิดโหมด "ทำแบบทดสอบข้ามหลักสูตร" ไว้ ให้เข้าทำข้อสอบได้ทุกบทโดยไม่ต้องเช็ก
    // target_group ตัวเองอีกต่อไป (ค่า default ปิดอยู่ = พฤติกรรมเดิมทุกอย่าง)
    const { allow_cross_track_testing } = await getAppSettings();

    const chapter = result.rows[0];
    res.status(200).json({
      success: true,
      data: {
        title: chapter.title,
        video_url: chapter.video_url,
        canTakeTest:
          allow_cross_track_testing || chapter.target_group === ownTargetGroup,
      },
    });
  } catch (error) {
    console.error("Get Regulator Chapter Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// ดึงรายการแบบทดสอบทั้งหมด
exports.getRegulatorTestsList = async (req, res) => {
  try {
    const userId = req.params.id;

    // กันไม่ให้ regulator คนอื่นเปลี่ยนเลข id ใน URL แล้วดูรายการแบบทดสอบของคนอื่นได้ (IDOR)
    if (parseInt(userId, 10) !== (req.user.account_id || req.user.id)) {
      return res
        .status(403)
        .json({ success: false, message: "ไม่มีสิทธิ์เข้าถึงข้อมูลนี้" });
    }

    const userQuery = `SELECT user_type FROM users WHERE id = $1`;
    const userResult = await db.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลผู้ใช้งาน" });
    }

    const ownTargetGroup = getTargetGroupFromUserType(
      userResult.rows[0].user_type,
    );

    // ถ้า admin เปิดโหมด "ทำแบบทดสอบข้ามหลักสูตร" ไว้ และหน้าบ้านระบุ targetGroup มาทาง query
    // (เช่นจาก tab เลือกหลักสูตร) ให้ใช้ค่านั้นแทน ไม่งั้น default เป็นหลักสูตรของตัวเองเหมือนเดิม
    const { allow_cross_track_testing } = await getAppSettings();
    let targetGroup = ownTargetGroup;
    if (allow_cross_track_testing && req.query.targetGroup) {
      const requestedGroup = parseInt(req.query.targetGroup, 10);
      if ([1, 2, 3].includes(requestedGroup)) {
        targetGroup = requestedGroup;
      }
    }

    const testQuery = `
      SELECT
        c.id AS "chapterId",
        c.title AS "chapterTitle",
        c.passing_percentage AS "passingPercentage",
        (SELECT COUNT(*) FROM questions q WHERE q.chapter_id = c.id) AS "totalQuestions",
        COALESCE(up.score, 0) AS "bestScore",
        COALESCE(up.is_passed, false) AS "isPassed",
        COALESCE(up.attempt_count, 0) AS "attemptCount"
      FROM chapters c
      LEFT JOIN user_progress up ON c.id = up.chapter_id AND up.user_id = $1
      WHERE c.target_group = $2 AND c.status = 'Active'
      ORDER BY c.id ASC
    `;
    const testResult = await db.query(testQuery, [userId, targetGroup]);

    res.status(200).json({
      success: true,
      data: testResult.rows,
      meta: {
        targetGroup,
        ownTargetGroup,
        allowCrossTrackTesting: allow_cross_track_testing,
      },
    });
  } catch (error) {
    console.error("Get Regulator Tests List Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงรายการแบบทดสอบ",
    });
  }
};

// ดึงคำถามของแบบทดสอบ 1 บท
exports.getRegulatorTestQuestions = async (req, res) => {
  try {
    const { chapterId } = req.params;

    const chapterQuery = `SELECT id, title, passing_percentage, target_group FROM chapters WHERE id = $1`;
    const chapterResult = await db.query(chapterQuery, [chapterId]);

    if (chapterResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบแบบทดสอบนี้" });
    }

    // เรียนดูวิดีโอได้ทุกหลักสูตร แต่ทำข้อสอบได้แค่หลักสูตรของ user_type ตัวเองเท่านั้น
    const ownUserId = req.user.account_id || req.user.id;
    const ownUserResult = await db.query(
      "SELECT user_type FROM users WHERE id = $1",
      [ownUserId],
    );
    const ownTargetGroup = getTargetGroupFromUserType(
      ownUserResult.rows[0]?.user_type,
    );
    const { allow_cross_track_testing } = await getAppSettings();
    if (
      !allow_cross_track_testing &&
      chapterResult.rows[0].target_group !== ownTargetGroup
    ) {
      return res.status(403).json({
        success: false,
        message: "ไม่สามารถทำแบบทดสอบของหลักสูตรอื่นได้",
      });
    }

    const questionsQuery = `SELECT id, question_text, options, correct_answer FROM questions WHERE chapter_id = $1 ORDER BY id ASC`;
    const questionsResult = await db.query(questionsQuery, [chapterId]);

    const formattedQuestions = questionsResult.rows.map((q) => {
      const optionsArray =
        typeof q.options === "string" ? JSON.parse(q.options) : q.options;

      let shuffledOptions = [...optionsArray];
      for (let i = shuffledOptions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledOptions[i], shuffledOptions[j]] = [
          shuffledOptions[j],
          shuffledOptions[i],
        ];
      }

      // หมายเหตุ: เจตนาไม่ส่ง index คำตอบที่ถูกกลับไปที่ client อีกต่อไป (เดิมส่ง `answer` ไปด้วย
      // ทำให้เปิด devtools ดูเฉลยก่อนตอบได้) การตรวจคำตอบทั้งหมดต้องทำฝั่งเซิร์ฟเวอร์เท่านั้น
      // ดู submitRegulatorTestResult ด้านล่าง

      return {
        id: q.id,
        q: q.question_text,
        options: shuffledOptions,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        chapter: chapterResult.rows[0],
        questions: formattedQuestions,
      },
    });
  } catch (error) {
    console.error("Get Regulator Test Questions Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการดึงคำถาม" });
  }
};

// บันทึกผลสอบ + ออกใบเซอถ้าผ่านครบทุกบท
exports.submitRegulatorTestResult = async (req, res) => {
  try {
    // ผู้ใช้ต้องเป็นเจ้าของผลสอบนี้เท่านั้น (ห้ามรับ userId จาก body เพราะปลอมส่งแทนคนอื่นได้)
    const userId = req.user.account_id || req.user.id;
    const { chapterId, answers } = req.body;

    if (!chapterId || !Array.isArray(answers)) {
      return res
        .status(400)
        .json({ success: false, message: "ข้อมูลคำตอบไม่ถูกต้อง" });
    }

    // ดึงเกณฑ์ผ่าน + กลุ่มหลักสูตรจาก DB เอง (ห้ามรับจาก body เพราะปลอมเกณฑ์ผ่านให้ตัวเองได้)
    const chapterQuery = await db.query(
      `SELECT passing_percentage, target_group FROM chapters WHERE id = $1`,
      [chapterId],
    );
    if (chapterQuery.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบแบบทดสอบนี้" });
    }
    const passingPercentage = chapterQuery.rows[0].passing_percentage;
    const targetGroup = chapterQuery.rows[0].target_group;

    // ทำข้อสอบได้เฉพาะบทเรียนที่ตรงกับ user_type ตัวเองเท่านั้น (เรียนดูวิดีโอได้ทุกหลักสูตร
    // แต่ทำข้อสอบ/รับใบเซอร์ได้แค่หลักสูตรของตัวเอง กันยิง endpoint นี้ตรง ๆ ข้ามหลักสูตร) - ยกเว้น
    // admin เปิดโหมด "ทำแบบทดสอบข้ามหลักสูตร" ไว้ที่หน้าตั้งค่าระบบ (ค่า default ปิดอยู่)
    const userTypeResult = await db.query(
      `SELECT user_type FROM users WHERE id = $1`,
      [userId],
    );
    const userType = userTypeResult.rows[0]?.user_type;
    const { allow_cross_track_testing } = await getAppSettings();
    if (
      !allow_cross_track_testing &&
      targetGroup !== getTargetGroupFromUserType(userType)
    ) {
      return res.status(403).json({
        success: false,
        message: "ไม่สามารถทำแบบทดสอบของหลักสูตรอื่นได้",
      });
    }

    // ดึงเฉลยจริงจาก DB มาตรวจเอง (ห้ามเชื่อคะแนนที่ client คำนวณมา ป้องกันปลอมผลสอบ/ใบเซอร์)
    const questionsResult = await db.query(
      `SELECT id, options, correct_answer FROM questions WHERE chapter_id = $1`,
      [chapterId],
    );
    const totalQuestions = questionsResult.rows.length;

    // สลับช้อยส์ตอนโหลดคำถามทุกครั้ง เลยอ้างอิง index เดิมไม่ได้ - เทียบด้วยข้อความคำตอบที่เลือกแทน
    const answerMap = new Map(
      answers
        .filter((a) => a && a.questionId !== undefined)
        .map((a) => [String(a.questionId), a.selectedOption]),
    );

    let score = 0;
    for (const q of questionsResult.rows) {
      const optionsArray =
        typeof q.options === "string" ? JSON.parse(q.options) : q.options;
      const correctText = optionsArray[parseInt(q.correct_answer, 10) || 0];
      if (answerMap.get(String(q.id)) === correctText) {
        score += 1;
      }
    }

    const scorePercentage =
      totalQuestions > 0 ? (score / totalQuestions) * 100 : 0;
    const isPassed = scorePercentage >= passingPercentage;

    const checkQuery = `SELECT * FROM user_progress WHERE user_id = $1 AND chapter_id = $2`;
    const checkResult = await db.query(checkQuery, [userId, chapterId]);

    let finalIsPassed = isPassed;

    if (checkResult.rows.length > 0) {
      const existingRecord = checkResult.rows[0];
      const newAttemptCount = (existingRecord.attempt_count || 0) + 1;
      const bestScore = Math.max(existingRecord.score || 0, score);
      finalIsPassed = existingRecord.is_passed ? true : isPassed;

      const updateQuery = `
        UPDATE user_progress
        SET score = $1, is_passed = $2, attempt_count = $3, last_attempt_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
      `;
      await db.query(updateQuery, [
        bestScore,
        finalIsPassed,
        newAttemptCount,
        existingRecord.id,
      ]);
    } else {
      const insertQuery = `
        INSERT INTO user_progress (user_id, chapter_id, score, is_passed, attempt_count, last_attempt_at, updated_at)
        VALUES ($1, $2, $3, $4, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;
      await db.query(insertQuery, [userId, chapterId, score, isPassed]);
    }

    const totalChaptersResult = await db.query(
      `
      SELECT COUNT(DISTINCT q.chapter_id) as total
      FROM questions q
      JOIN chapters c ON q.chapter_id = c.id
      WHERE c.target_group = $1
    `,
      [targetGroup],
    );
    const totalTestableChapters = parseInt(totalChaptersResult.rows[0].total);

    const passedChaptersResult = await db.query(
      `
      SELECT COUNT(DISTINCT up.chapter_id) as passed_count
      FROM user_progress up
      JOIN chapters c ON up.chapter_id = c.id
      WHERE up.user_id = $1 AND up.is_passed = true AND c.target_group = $2
    `,
      [userId, targetGroup],
    );
    const passedChaptersCount = parseInt(
      passedChaptersResult.rows[0].passed_count,
    );

    const isAllPassed =
      totalTestableChapters > 0 && passedChaptersCount >= totalTestableChapters;

    let certSettings = null;

    if (isAllPassed) {
      const courseGroupId = targetGroup;
      let certId;
      let certNumber;

      const checkCert = await db.query(
        `SELECT id, cert_number FROM certificates WHERE user_id = $1 AND course_group = $2`,
        [userId, courseGroupId],
      );

      if (checkCert.rows.length === 0) {
        // เลือก prefix เลขที่ (dev/res/reg/pol/ser/usr/gen) จาก user_type ที่ดึงไว้แล้วด้านบน
        // ถ้าตรงกับหลักสูตรที่สอบผ่านอยู่แล้ว หรือจาก target_group ของหลักสูตรเองถ้าสอบข้ามหลักสูตร
        certNumber = await generateCertNumber(userType, targetGroup);

        const insertCert = await db.query(
          `INSERT INTO certificates (user_id, course_group, issued_at, cert_number)
           VALUES ($1, $2, CURRENT_TIMESTAMP, $3) RETURNING id`,
          [userId, courseGroupId, certNumber],
        );
        certId = insertCert.rows[0].id;
      } else {
        certId = checkCert.rows[0].id;
        certNumber = checkCert.rows[0].cert_number;
      }

      const settingsQuery = await db.query(
        `SELECT * FROM certificate_settings WHERE course_group = $1`,
        [courseGroupId],
      );
      certSettings = settingsQuery.rows[0] || {};
      certSettings.certId = certId;
      certSettings.certNumber = certNumber;
    }

    res.status(200).json({
      success: true,
      data: {
        score,
        totalQuestions,
        isPassed: finalIsPassed,
        scorePercentage,
        isAllPassed,
        certSettings,
      },
    });
  } catch (error) {
    console.error("Submit Regulator Test Error:", error);
    res.status(500).json({ success: false, message: "บันทึกผลสอบไม่สำเร็จ" });
  }
};

// ดึงข้อมูลตั้งต้นของเครื่องมือประเมิน (maturity levels + principles)
exports.getRegulatorToolSetupData = async (req, res) => {
  try {
    // เช็คว่าผู้ใช้ที่ล็อกอินอยู่มีหน่วยงานสังกัดหรือไม่ (เผื่อกรณี regulator ถูกถอดออกจากหน่วยงาน)
    const currentUserId = req.user.account_id || req.user.id;
    const orgCheck = await db.query(
      "SELECT organization_id FROM users WHERE id = $1",
      [currentUserId],
    );
    const hasOrganization =
      orgCheck.rows.length > 0 && orgCheck.rows[0].organization_id !== null;

    const principles = await db.query(
      "SELECT id, name, description FROM principles ORDER BY id ASC",
    );

    if (hasOrganization) {
      const maturities = await db.query(
        "SELECT level_id, level_name, description FROM maturity_levels WHERE is_active = true ORDER BY level_id ASC",
      );
      return res.status(200).json({
        success: true,
        data: {
          levelType: "maturity",
          maturities: maturities.rows,
          principles: principles.rows,
        },
      });
    }

    const impacts = await db.query(
      "SELECT level_id, level_name, description FROM impact_levels WHERE is_active = true ORDER BY level_id ASC",
    );
    res.status(200).json({
      success: true,
      data: {
        levelType: "impact",
        maturities: impacts.rows,
        principles: principles.rows,
      },
    });
  } catch (error) {
    console.error("Get Regulator Tool Setup Error:", error);
    res
      .status(500)
      .json({ success: false, message: "ดึงข้อมูลตั้งต้นไม่สำเร็จ" });
  }
};

// ประมวลผลและสร้างเครื่องมือประเมิน (บันทึกลง user_tools_history)
exports.generateRegulatorToolResult = async (req, res) => {
  try {
    // ผู้ใช้ต้องสร้างผลประเมินให้ตัวเองเท่านั้น (ห้ามรับ userId จาก body เพราะสร้างแทนคนอื่นได้)
    const userId = req.user.account_id || req.user.id;
    const { maturityId, principleIds } = req.body;

    const userResult = await db.query(
      "SELECT user_type, organization_id FROM users WHERE id = $1",
      [userId],
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "ไม่พบ User" });
    }
    const userType = userResult.rows[0].user_type || "user";
    const hasOrganization = userResult.rows[0].organization_id !== null;

    // ถ้าไม่มีหน่วยงานสังกัด: maturityId ที่ส่งมาคือ Impact Level ID ต้องแปลงเป็น Maturity Level ก่อน
    let actualMaturityId = maturityId;
    let impactInfo = null;

    if (!hasOrganization) {
      const impactResult = await db.query(
        "SELECT level_id, level_name, description, base_maturity_level FROM impact_levels WHERE level_id = $1",
        [maturityId],
      );
      if (impactResult.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "ไม่พบระดับผลกระทบนี้" });
      }
      impactInfo = impactResult.rows[0];
      actualMaturityId = impactInfo.base_maturity_level;
    }

    let roleStr = "user";
    if (userType.toLowerCase().includes("regulator")) {
      roleStr = "regulator";
    } else if (userType.toLowerCase().includes("policy")) {
      roleStr = "policy";
    } else if (userType.toLowerCase().includes("researcher")) {
      roleStr = "researcher";
    } else if (userType.toLowerCase().includes("developer")) {
      roleStr = "developer";
    } else if (userType.toLowerCase().includes("provider")) {
      roleStr = "service provider";
    } else if (userType.toLowerCase().includes("users")) {
      roleStr = "users";
    }

    const compQuery = `
      SELECT DISTINCT c.id, c.title, c.max_maturity_level
      FROM components c
      JOIN component_principles cp ON c.id = cp.component_id
      WHERE LOWER(c.role) = LOWER($1) AND cp.principle_id = ANY($2::varchar[])
      ORDER BY c.id ASC
    `;
    const components = await db.query(compQuery, [roleStr, principleIds]);

    const guideQuery = `
      SELECT analysis, strengths, gaps, risks, recommendations, roadmap
      FROM evaluation_guidelines
      WHERE LOWER(user_type) = LOWER($1) AND level_id = $2
    `;
    const guidelines = await db.query(guideQuery, [userType, actualMaturityId]);

    const matInfo = await db.query(
      "SELECT level_id, level_name, description FROM maturity_levels WHERE level_id = $1",
      [actualMaturityId],
    );
    const prinInfo = await db.query(
      "SELECT id, name, description FROM principles WHERE id = ANY($1::varchar[])",
      [principleIds],
    );

    const resultSnapshot = {
      userType: userType,
      matchedRole: roleStr,
      date: new Date().toLocaleDateString("th-TH", {
        timeZone: "Asia/Bangkok",
      }),
      maturity: matInfo.rows[0],
      impact: impactInfo,
      principles: prinInfo.rows,
      components: components.rows,
      guideline: guidelines.rows.length > 0 ? guidelines.rows[0] : null,
    };

    const insertHistoryQuery = `
      INSERT INTO user_tools_history (user_id, maturity_id, result_data)
      VALUES ($1, $2, $3)
      RETURNING id, created_at
    `;
    const historyResult = await db.query(insertHistoryQuery, [
      userId,
      actualMaturityId,
      JSON.stringify(resultSnapshot),
    ]);

    res.status(200).json({
      success: true,
      data: {
        id: historyResult.rows[0].id,
        ...resultSnapshot,
      },
    });
  } catch (error) {
    console.error("Generate Regulator Tool Error:", error);
    res
      .status(500)
      .json({ success: false, message: "สร้างเครื่องมือประเมินไม่สำเร็จ" });
  }
};

// ดึงประวัติเครื่องมือประเมินทั้งหมด
exports.getRegulatorToolsHistoryList = async (req, res) => {
  try {
    const userId = req.params.id;

    // กันไม่ให้ regulator คนอื่นเปลี่ยนเลข id ใน URL แล้วดูประวัติประเมินของคนอื่นได้ (IDOR)
    if (parseInt(userId, 10) !== (req.user.account_id || req.user.id)) {
      return res
        .status(403)
        .json({ success: false, message: "ไม่มีสิทธิ์เข้าถึงข้อมูลนี้" });
    }

    const query = `
      SELECT id, result_data
      FROM user_tools_history
      WHERE user_id = $1
      ORDER BY id DESC
    `;
    const result = await db.query(query, [userId]);

    const formattedData = result.rows.map((row) => ({
      id: row.id,
      ...row.result_data,
    }));

    res.status(200).json({ success: true, data: formattedData });
  } catch (error) {
    console.error("Get Regulator Tools History List Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงประวัติการประเมิน",
    });
  }
};

// ลบประวัติเครื่องมือประเมิน
exports.deleteRegulatorToolHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.account_id || req.user.id;
    // เช็ค user_id คู่กับ id เสมอ กันลบประวัติของคนอื่น (ไล่เลข id) ได้
    const result = await db.query(
      "DELETE FROM user_tools_history WHERE id = $1 AND user_id = $2",
      [id, userId],
    );
    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบประวัติการประเมินนี้" });
    }
    res
      .status(200)
      .json({ success: true, message: "ลบประวัติการประเมินสำเร็จ" });
  } catch (error) {
    console.error("Delete Regulator Tool History Error:", error);
    res.status(500).json({ success: false, message: "ลบข้อมูลไม่สำเร็จ" });
  }
};

// ดึงใบประกาศนียบัตรทั้งหมดของ Regulator
exports.getRegulatorCertificates = async (req, res) => {
  try {
    const { userId } = req.params;

    // กันไม่ให้ regulator คนอื่นเปลี่ยนเลข id ใน URL แล้วดูใบเซอร์ของคนอื่นได้ (IDOR)
    if (parseInt(userId, 10) !== (req.user.account_id || req.user.id)) {
      return res
        .status(403)
        .json({ success: false, message: "ไม่มีสิทธิ์เข้าถึงข้อมูลนี้" });
    }

    const certQuery = `
      SELECT
        c.id as cert_id, c.course_group, c.issued_at, c.cert_number,
        cs.course_name, cs.signatory_name, cs.signatory_position,
        cs.background_url, cs.logo_url, cs.signature_url,
        cs.issuer_name, cs.description
      FROM certificates c
      LEFT JOIN certificate_settings cs ON c.course_group = cs.course_group
      WHERE c.user_id = $1
      ORDER BY c.issued_at DESC
    `;
    const certResult = await db.query(certQuery, [userId]);

    if (certResult.rows.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const certificates = await Promise.all(
      certResult.rows.map(async (cert) => {
        const targetGroup = cert.course_group;

        const totalChaptersResult = await db.query(
          `
        SELECT COUNT(DISTINCT q.chapter_id) as total
        FROM questions q
        JOIN chapters c ON q.chapter_id = c.id
        WHERE c.target_group = $1
      `,
          [targetGroup],
        );
        const totalTestableChapters = parseInt(
          totalChaptersResult.rows[0].total,
        );

        return {
          certId: cert.cert_id,
          certNumber: cert.cert_number,
          course_name: cert.course_name || "AI Ethics Management",
          signatory_name: cert.signatory_name,
          signatory_position: cert.signatory_position,
          background_url: cert.background_url,
          logo_url: cert.logo_url,
          signature_url: cert.signature_url,
          issuer_name: cert.issuer_name,
          description: cert.description,
          passDate: new Date(cert.issued_at).toLocaleDateString("th-TH", {
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "Asia/Bangkok",
          }),
          score: totalTestableChapters,
          totalQuestions: totalTestableChapters,
        };
      }),
    );

    res.status(200).json({ success: true, data: certificates });
  } catch (error) {
    console.error("Get Regulator Certificates Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงใบประกาศนียบัตร",
    });
  }
};

// ==========================================
// ข้อมูลหน่วยงานของตัวเอง (สำหรับหน้า "ข้อมูลหน่วยงาน" ใน Sidebar)
// ==========================================

// ดึงข้อมูลโปรไฟล์หน่วยงาน + สถิติ + รายชื่อผู้กำกับดูแลในหน่วยงาน
exports.getOrganizationInfo = async (req, res) => {
  try {
    const userId = req.user.account_id || req.user.id;
    const orgQuery = await db.query(
      "SELECT organization_id FROM users WHERE id = $1",
      [userId],
    );
    const orgId = orgQuery.rows[0]?.organization_id;

    if (!orgId) {
      return res.status(404).json({
        success: false,
        message: "บัญชีของคุณไม่มีหน่วยงานสังกัด",
      });
    }

    const orgResult = await db.query(
      `SELECT id, org_code, org_name, status, sector, created_at
       FROM organizations
       WHERE id = $1`,
      [orgId],
    );

    if (orgResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลหน่วยงานนี้ในระบบ" });
    }

    const statsResult = await db.query(
      `SELECT
        (SELECT COUNT(*) FROM users WHERE organization_id = $1) as total_users,
        (SELECT COUNT(*) FROM users WHERE organization_id = $1 AND role = 'regulator') as total_regulators,
        (SELECT COUNT(*) FROM users WHERE organization_id = $1 AND role = 'user') as total_members,
        (SELECT COUNT(*) FROM projects WHERE organization_id = $1) as total_projects,
        (SELECT COUNT(*) FROM certificates c
           JOIN users u ON c.user_id = u.id
           WHERE u.organization_id = $1) as total_certificates
      `,
      [orgId],
    );

    const regulatorsResult = await db.query(
      `SELECT
         u.id, u.username, u.created_at,
         p.first_name_th || ' ' || p.last_name_th AS name,
         p.email
       FROM users u
       LEFT JOIN profiles p ON u.id = p.user_id
       WHERE u.organization_id = $1 AND u.role = 'regulator'
       ORDER BY u.created_at ASC`,
      [orgId],
    );

    const stats = statsResult.rows[0];

    res.json({
      success: true,
      data: {
        organization: orgResult.rows[0],
        stats: {
          totalUsers: parseInt(stats.total_users) || 0,
          totalRegulators: parseInt(stats.total_regulators) || 0,
          totalMembers: parseInt(stats.total_members) || 0,
          totalProjects: parseInt(stats.total_projects) || 0,
          totalCertificates: parseInt(stats.total_certificates) || 0,
        },
        regulators: regulatorsResult.rows,
      },
    });
  } catch (error) {
    console.error("Get Regulator Organization Info Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลหน่วยงาน",
    });
  }
};

// แก้ไขชื่อหน่วยงานของตัวเอง (org_code / status ปรับได้เฉพาะฝั่ง Admin เท่านั้น)
// sector: Regulator ตั้งค่าได้ "ครั้งเดียว" เฉพาะตอนที่หน่วยงานยังไม่เคยมีค่านี้ (หลังจากนั้นต้องให้ Admin แก้แทน)
exports.editOrganizationInfo = async (req, res) => {
  const { org_name, sector } = req.body;

  const hasNameChange = org_name && org_name.trim() !== "";
  if (!hasNameChange && !sector) {
    return res
      .status(400)
      .json({ success: false, message: "กรุณาระบุข้อมูลที่ต้องการแก้ไข" });
  }
  if (sector && !VALID_SECTORS.includes(sector)) {
    return res.status(400).json({
      success: false,
      message: "กรุณาเลือกกลุ่มอุตสาหกรรม (Sector) ให้ถูกต้อง",
    });
  }

  try {
    const userId = req.user.account_id || req.user.id;
    const orgQuery = await db.query(
      "SELECT organization_id FROM users WHERE id = $1",
      [userId],
    );
    const orgId = orgQuery.rows[0]?.organization_id;

    if (!orgId) {
      return res.status(404).json({
        success: false,
        message: "บัญชีของคุณไม่มีหน่วยงานสังกัด",
      });
    }

    const setClauses = [];
    const params = [];

    if (hasNameChange) {
      params.push(org_name.trim());
      setClauses.push(`org_name = $${params.length}`);
    }

    if (sector) {
      const currentOrg = await db.query(
        "SELECT sector FROM organizations WHERE id = $1",
        [orgId],
      );
      if (currentOrg.rows[0]?.sector) {
        return res.status(400).json({
          success: false,
          message:
            "หน่วยงานนี้มีการกำหนด Sector ไว้แล้ว กรุณาติดต่อผู้ดูแลระบบหากต้องการเปลี่ยนแปลง",
        });
      }
      params.push(sector);
      setClauses.push(`sector = $${params.length}`);
    }

    params.push(orgId);
    await db.query(
      `UPDATE organizations SET ${setClauses.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = $${params.length}`,
      params,
    );

    res.json({ success: true, message: "แก้ไขข้อมูลหน่วยงานสำเร็จ" });
  } catch (error) {
    console.error("Edit Regulator Organization Info Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการแก้ไขข้อมูลหน่วยงาน",
    });
  }
};

// ดึงรายการ Activities ของ Component หนึ่งๆ (ใช้แสดงในป็อปอัพหน้าผลการประเมิน)
exports.getRegulatorComponentActivities = async (req, res) => {
  const { componentId } = req.params;

  try {
    const activitiesResult = await db.query(
      `SELECT id, activity_text, maturity_level
       FROM component_activities
       WHERE component_id = $1
       ORDER BY maturity_level ASC, sort_order ASC, id ASC`,
      [componentId],
    );

    res.json({ success: true, data: activitiesResult.rows });
  } catch (error) {
    console.error("Get Regulator Component Activities Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูล Activities",
    });
  }
};

// ==========================================
// หน้า "ข้อมูลส่วนตัว" (Profile) - ดูและแก้ไขข้อมูลของตัวเองเท่านั้น
// ==========================================
exports.getRegulatorProfile = async (req, res) => {
  try {
    const userId = req.user.account_id || req.user.id;

    const result = await db.query(
      `SELECT
         u.username, u.user_type, u.role,
         p.first_name_th, p.last_name_th, p.email, p.mobile, p.user_code,
         p.profile_image_url,
         o.org_name
       FROM users u
       LEFT JOIN profiles p ON u.id = p.user_id
       LEFT JOIN organizations o ON u.organization_id = o.id
       WHERE u.id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลผู้ใช้งาน" });
    }

    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error("Get Regulator Profile Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลส่วนตัว" });
  }
};

exports.updateRegulatorProfile = async (req, res) => {
  try {
    const userId = req.user.account_id || req.user.id;
    const { first_name, last_name, email, mobile } = req.body;

    if (!first_name || !last_name || !email) {
      return res.status(400).json({
        success: false,
        message: "กรุณากรอกชื่อ นามสกุล และอีเมลให้ครบถ้วน",
      });
    }
    if (!isValidPhone(mobile)) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุเบอร์โทรศัพท์ให้ถูกต้อง (ตัวเลข 9-10 หลัก ขึ้นต้นด้วย 0)",
      });
    }

    // เช็คอีเมลซ้ำกับคนอื่น (ไม่นับแถวของตัวเอง) ก่อน UPDATE เพราะ profiles.email เป็น UNIQUE
    const checkEmail = await db.query(
      "SELECT id FROM profiles WHERE email = $1 AND user_id != $2",
      [email, userId],
    );
    if (checkEmail.rows.length > 0) {
      return res
        .status(400)
        .json({ success: false, message: "อีเมลนี้ถูกใช้งานโดยบัญชีอื่นแล้ว" });
    }

    const result = await db.query(
      `UPDATE profiles
       SET first_name_th = $1, last_name_th = $2, email = $3, mobile = $4, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $5`,
      [first_name, last_name, email, mobile, userId],
    );

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลโปรไฟล์เพื่อทำการอัปเดต" });
    }

    res.status(200).json({ success: true, message: "บันทึกข้อมูลส่วนตัวสำเร็จ" });
  } catch (error) {
    console.error("Update Regulator Profile Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกข้อมูลส่วนตัว" });
  }
};

// อัปโหลด/เปลี่ยนรูปโปรไฟล์ (แยก endpoint จาก updateRegulatorProfile เพราะเป็น multipart/
// form-data ไม่ใช่ JSON) - middleware อัปโหลดไฟล์อยู่ที่ routes/regulatorRoutes.js
exports.uploadRegulatorProfileImage = async (req, res) => {
  try {
    const userId = req.user.account_id || req.user.id;

    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "กรุณาเลือกไฟล์รูปภาพ" });
    }

    const imageUrl = `${process.env.MYAPP_BACKEND_URL}/uploads/profile-images/${req.file.filename}`;

    const oldResult = await db.query(
      "SELECT profile_image_url FROM profiles WHERE user_id = $1",
      [userId],
    );
    const oldImageUrl = oldResult.rows[0]?.profile_image_url;

    await db.query(
      "UPDATE profiles SET profile_image_url = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2",
      [imageUrl, userId],
    );

    if (oldImageUrl && oldImageUrl.includes("/uploads/profile-images/")) {
      const oldFilename = oldImageUrl.split("/uploads/profile-images/")[1];
      if (oldFilename) {
        fs.unlink(path.join(UPLOAD_DIR, oldFilename), (err) => {
          if (err && err.code !== "ENOENT") {
            console.error("Delete Old Profile Image Error:", err);
          }
        });
      }
    }

    res.status(200).json({
      success: true,
      message: "อัปโหลดรูปโปรไฟล์สำเร็จ",
      data: { profile_image_url: imageUrl },
    });
  } catch (error) {
    console.error("Upload Regulator Profile Image Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการอัปโหลดรูป" });
  }
};
