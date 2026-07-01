const db = require("../db");
const bcrypt = require("bcryptjs");

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

    const totalProjectsRes = await db.query(
      "SELECT COUNT(*) FROM projects WHERE organization_id = $1",
      [orgId],
    );
    const totalUsersRes = await db.query(
      "SELECT COUNT(*) FROM users WHERE organization_id = $1 AND role != 'admin'",
      [orgId],
    );
    const pendingProjectsRes = await db.query(
      "SELECT COUNT(*) FROM projects WHERE organization_id = $1 AND status = 'Pending'",
      [orgId],
    );
    const activeProjectsRes = await db.query(
      "SELECT COUNT(*) FROM projects WHERE organization_id = $1 AND status != 'Pending'",
      [orgId],
    );

    const chartRes = await db.query(
      `SELECT status as name, COUNT(*) as projects FROM projects WHERE organization_id = $1 GROUP BY status`,
      [orgId],
    );
    const chartData = chartRes.rows.map((row) => {
      let color = "#10b981";
      if (row.name === "Pending") color = "#f59e0b";
      if (row.name === "High Risk" || row.name === "Rejected")
        color = "#ef4444";
      return { name: row.name, projects: parseInt(row.projects), color };
    });

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
      SELECT p.id, p.project_name, p.status, p.created_at, p.progress, pr.first_name_th || ' ' || pr.last_name_th AS manager
      FROM projects p LEFT JOIN users u ON p.created_by = u.id LEFT JOIN profiles pr ON u.id = pr.user_id
      WHERE p.organization_id = $1 ORDER BY p.created_at DESC LIMIT 5
    `,
      [orgId],
    );

    res.json({
      success: true,
      data: {
        orgName: orgName,
        stats: {
          totalProjects: parseInt(totalProjectsRes.rows[0].count) || 0,
          totalUsers: parseInt(totalUsersRes.rows[0].count) || 0,
          pendingProjects: parseInt(pendingProjectsRes.rows[0].count) || 0,
          activeProjects: parseInt(activeProjectsRes.rows[0].count) || 0,
        },
        chartData: chartData,
        recentUsers: usersRes.rows,
        recentProjects: projectsRes.rows,
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
        p.email,
        p.id_card
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
  const { username, password, name, email, id_card, user_type } = req.body;

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

    if (id_card) {
      const checkIdCard = await db.query(
        "SELECT id FROM profiles WHERE id_card = $1",
        [id_card],
      );
      if (checkIdCard.rows.length > 0) {
        await db.query("ROLLBACK");
        return res
          .status(400)
          .json({
            success: false,
            message: "เลขประจำตัวประชาชนนี้มีอยู่ในระบบแล้ว",
          });
      }
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
      `INSERT INTO profiles (user_id, first_name_th, last_name_th, email, id_card, is_verified) VALUES ($1, $2, $3, $4, $5, true)`,
      [newUserId, firstName, lastName, email, id_card],
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
        p.status, 
        p.created_at,
        (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) as total_members,
        pr.first_name_th || ' ' || pr.last_name_th AS manager
      FROM projects p
      LEFT JOIN users u ON p.created_by = u.id
      LEFT JOIN profiles pr ON u.id = pr.user_id
      WHERE p.organization_id = $1
      ORDER BY p.created_at DESC
    `,
      [orgId],
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Get Projects Error:", error);
    res
      .status(500)
      .json({ success: false, message: "ดึงข้อมูลโครงการผิดพลาด" });
  }
};

// 6. สร้างโครงการใหม่
exports.addProject = async (req, res) => {
  const { project_code, project_name } = req.body;

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
      `INSERT INTO projects (project_code, project_name, organization_id, created_by, progress, status) 
       VALUES ($1, $2, $3, $4, 0, 'Pending')`,
      [project_code, project_name, orgId, userId],
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
      return res
        .status(400)
        .json({
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
      `SELECT id, project_code, project_name, progress, created_at 
       FROM projects 
       WHERE id = $1 AND organization_id = $2`,
      [id, orgId],
    );

    if (projectResult.rows.length === 0) {
      return res
        .status(404)
        .json({
          success: false,
          message: "ไม่พบข้อมูลโครงการ หรือคุณไม่มีสิทธิ์เข้าถึง",
        });
    }

    const projectData = projectResult.rows[0];

    const membersResult = await db.query(
      `SELECT 
         u.id, 
         u.username, 
         p.first_name_th || ' ' || p.last_name_th AS name,
         p.email
       FROM project_members pm
       JOIN users u ON pm.user_id = u.id
       LEFT JOIN profiles p ON u.id = p.user_id
       WHERE pm.project_id = $1`,
      [id],
    );

    res.json({
      success: true,
      data: {
        project: projectData,
        members: membersResult.rows,
      },
    });
  } catch (error) {
    console.error("View Project Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลโครงการ" });
  }
};
