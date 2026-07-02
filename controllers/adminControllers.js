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

// --- GET CHAPTERS (ดึงข้อมูลบทเรียนทั้งหมด) ---
  exports.getChapters = async (req, res) => {
    try {
      const query = `
      SELECT 
        c.id, 
        c.title, 
        c.target_group AS "targetGroup", 
        c.status,
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
      // ใช้ getClient() สำหรับสร้าง Transaction ให้เซฟ 2 ตารางพร้อมกัน
      client = await db.getClient();
      await client.query("BEGIN");

      const { title, targetRole, status, videoUrl, questions } = req.body;

      // แปลงชื่อกลุ่มเป้าหมายเป็นตัวเลข
      let targetGroup = 1;
      if (targetRole === "Group 2") targetGroup = 2;
      else if (targetRole === "Group 3") targetGroup = 3;

      // 1. Insert ลงตาราง chapters
      const insertChapterQuery = `
      INSERT INTO chapters (title, target_group, video_url, status)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `;
      const chapterResult = await client.query(insertChapterQuery, [
        title,
        targetGroup,
        videoUrl,
        status,
      ]);
      const newChapterId = chapterResult.rows[0].id;

      // 2. Insert ข้อสอบลงตาราง questions
      if (questions && questions.length > 0) {
        const insertQuestionQuery = `
        INSERT INTO questions (chapter_id, question_text, options, correct_answer)
        VALUES ($1, $2, $3, $4)
      `;
        for (let q of questions) {
          await client.query(insertQuestionQuery, [
            newChapterId,
            q.questionText,
            JSON.stringify(q.options), // แปลง array เป็น JSONB
            q.correctAnswer,
          ]);
        }
      }

      await client.query("COMMIT"); // ยืนยันการเซฟข้อมูลทั้งหมด
      res.status(201).json({
        success: true,
        message: "บันทึกบทเรียนและข้อสอบเรียบร้อยแล้ว",
        data: { chapterId: newChapterId },
      });
    } catch (error) {
      if (client) await client.query("ROLLBACK"); // ถ้าพังให้ยกเลิกการเซฟทั้งหมด
      console.error("Create Chapter Error:", error);
      res
        .status(500)
        .json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกข้อมูล" });
    } finally {
      if (client) client.release(); // คืนการเชื่อมต่อกลับสู่ pool
    }
  };
