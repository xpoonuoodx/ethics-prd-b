const db = require("../db");
const bcrypt = require("bcryptjs");
const { isValidUsername, isValidPassword } = require("../utils/validators");

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

    if (id_card) {
      const checkIdCard = await db.query(
        "SELECT id FROM profiles WHERE id_card = $1",
        [id_card],
      );
      if (checkIdCard.rows.length > 0) {
        await db.query("ROLLBACK");
        return res.status(400).json({
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

exports.viewUser = async (req, res) => {
  try {
    const { id } = req.params;

    // ดึงข้อมูลพื้นฐานคล้ายของแอดมิน แต่อาจต้องตรวจสอบให้แน่ใจว่า user คนนี้อยู่ใต้ org เดียวกัน (ถ้ามีระบบจำกัด)
    const query = `
      SELECT 
        u.id, 
        u.username, 
        p.email,
        p.id_card,
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

// 8a. แก้ไขชื่อโครงการ
exports.editProject = async (req, res) => {
  const { id } = req.params;
  const { project_name } = req.body;

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

    await db.query("UPDATE projects SET project_name = $1 WHERE id = $2", [
      project_name.trim(),
      id,
    ]);

    res.json({ success: true, message: "แก้ไขชื่อโครงการสำเร็จ" });
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
      `SELECT id, project_code, project_name, progress, created_at 
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

// ==========================================
// สื่อการเรียนรู้และแบบประเมิน สำหรับ Regulator (แยกจาก userControllers เป็น endpoint ของตัวเอง)
// ==========================================

// ดึงรายการสื่อการเรียนรู้ (Classroom)
exports.getRegulatorClassroom = async (req, res) => {
  try {
    const userId = req.params.id;

    const userQuery = `SELECT user_type FROM users WHERE id = $1`;
    const userResult = await db.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลผู้ใช้งาน" });
    }

    const typeStr = (userResult.rows[0].user_type || "").toLowerCase();
    let targetGroup = 3;
    let courseTitle = "หลักสูตรสำหรับผู้ใช้งานทั่วไป (General User)";
    let courseDesc =
      "สร้างความตระหนักรู้และเข้าใจผลกระทบของการใช้งาน AI ในชีวิตประจำวัน";

    if (typeStr.includes("regulator") || typeStr.includes("policy")) {
      targetGroup = 1;
      courseTitle = "หลักสูตรสำหรับผู้วางนโยบาย (Regulator)";
      courseDesc =
        "เรียนรู้แนวทางการกำกับดูแลและการสร้างนโยบาย AI ที่สอดคล้องกับหลักจริยธรรมระดับชาติ";
    } else if (
      typeStr.includes("provider") ||
      typeStr.includes("developer") ||
      typeStr.includes("researcher")
    ) {
      targetGroup = 2;
      courseTitle =
        "หลักสูตรสำหรับนักพัฒนา (Researcher, Developer, Service Provider)";
      courseDesc =
        "เรียนรู้การออกแบบและพัฒนาโมเดล AI ที่มีความโปร่งใส อธิบายได้ และลดความลำเอียง";
    }

    const chaptersQuery = `
      SELECT
        c.id AS "chapterId",
        c.title AS "chapterTitle",
        COALESCE(up.is_passed, false) AS "isPassed",
        up.score AS "userScore",
        (SELECT COUNT(*) FROM questions q WHERE q.chapter_id = c.id) AS "totalQuestions"
      FROM chapters c
      LEFT JOIN user_progress up ON c.id = up.chapter_id AND up.user_id = $1
      WHERE c.target_group = $2 AND c.status = 'Active'
      ORDER BY c.id ASC
    `;
    const chaptersResult = await db.query(chaptersQuery, [userId, targetGroup]);

    res.status(200).json({
      success: true,
      data: {
        courseTitle,
        courseDesc,
        chapters: chaptersResult.rows,
      },
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
      "SELECT title, video_url FROM chapters WHERE id = $1",
      [id],
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลบทเรียน" });
    }

    res.status(200).json({ success: true, data: result.rows[0] });
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

    const userQuery = `SELECT user_type FROM users WHERE id = $1`;
    const userResult = await db.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลผู้ใช้งาน" });
    }

    const typeStr = (userResult.rows[0].user_type || "").toLowerCase();
    let targetGroup = 3;
    if (typeStr.includes("regulator") || typeStr.includes("policy"))
      targetGroup = 1;
    else if (
      typeStr.includes("provider") ||
      typeStr.includes("developer") ||
      typeStr.includes("researcher")
    )
      targetGroup = 2;

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

    res.status(200).json({ success: true, data: testResult.rows });
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

    const chapterQuery = `SELECT id, title, passing_percentage FROM chapters WHERE id = $1`;
    const chapterResult = await db.query(chapterQuery, [chapterId]);

    if (chapterResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบแบบทดสอบนี้" });
    }

    const questionsQuery = `SELECT id, question_text, options, correct_answer FROM questions WHERE chapter_id = $1 ORDER BY id ASC`;
    const questionsResult = await db.query(questionsQuery, [chapterId]);

    const formattedQuestions = questionsResult.rows.map((q) => {
      const optionsArray =
        typeof q.options === "string" ? JSON.parse(q.options) : q.options;

      const correctIndexDB = parseInt(q.correct_answer, 10) || 0;
      const correctText = optionsArray[correctIndexDB];

      let shuffledOptions = [...optionsArray];
      for (let i = shuffledOptions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledOptions[i], shuffledOptions[j]] = [
          shuffledOptions[j],
          shuffledOptions[i],
        ];
      }

      const newCorrectIndex = shuffledOptions.indexOf(correctText);

      return {
        id: q.id,
        q: q.question_text,
        options: shuffledOptions,
        answer: newCorrectIndex,
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
    const { userId, chapterId, score, totalQuestions, passingPercentage } =
      req.body;

    const scorePercentage = (score / totalQuestions) * 100;
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

    const targetQuery = await db.query(
      `SELECT target_group FROM chapters WHERE id = $1`,
      [chapterId],
    );
    const targetGroup = targetQuery.rows[0].target_group;

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

      const checkCert = await db.query(
        `SELECT id FROM certificates WHERE user_id = $1 AND course_group = $2`,
        [userId, courseGroupId],
      );

      if (checkCert.rows.length === 0) {
        const insertCert = await db.query(
          `INSERT INTO certificates (user_id, course_group, issued_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id`,
          [userId, courseGroupId],
        );
        certId = insertCert.rows[0].id;
      } else {
        certId = checkCert.rows[0].id;
      }

      const settingsQuery = await db.query(
        `SELECT * FROM certificate_settings WHERE course_group = $1`,
        [courseGroupId],
      );
      certSettings = settingsQuery.rows[0] || {};
      certSettings.certId = certId;
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
    const { userId, maturityId, principleIds } = req.body;

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
      roleStr = "provider";
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
      date: new Date().toLocaleDateString("th-TH"),
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
    await db.query("DELETE FROM user_tools_history WHERE id = $1", [id]);
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

    const certQuery = `
      SELECT
        c.id as cert_id, c.course_group, c.issued_at,
        cs.course_name, cs.signatory_name, cs.signatory_position,
        cs.background_url, cs.logo_url, cs.signature_url
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
          course_name: cert.course_name || "AI Ethics Management",
          signatory_name: cert.signatory_name,
          signatory_position: cert.signatory_position,
          background_url: cert.background_url,
          logo_url: cert.logo_url,
          signature_url: cert.signature_url,
          passDate: new Date(cert.issued_at).toLocaleDateString("th-TH", {
            year: "numeric",
            month: "long",
            day: "numeric",
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
