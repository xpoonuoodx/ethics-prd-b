const db = require("../db");

// --- GET USER DASHBOARD DATA ---
exports.getUserDashboard = async (req, res) => {
  try {
    const userId = req.params.id;

    // 1. ดึงข้อมูลรายละเอียดผู้ใช้ สังกัดองค์กร และโปรเจค
    const userQuery = `
      SELECT 
        u.id, 
        u.username, 
        u.user_type, 
        p.first_name_th, 
        p.last_name_th,
        o.org_name,
        STRING_AGG(proj.project_name, ', ') AS projects
      FROM users u
      LEFT JOIN profiles p ON u.id = p.user_id
      LEFT JOIN organizations o ON u.organization_id = o.id
      LEFT JOIN project_members pm ON u.id = pm.user_id
      LEFT JOIN projects proj ON pm.project_id = proj.id
      WHERE u.id = $1
      GROUP BY u.id, p.first_name_th, p.last_name_th, o.org_name
    `;
    const userResult = await db.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลผู้ใช้งาน" });
    }

    const userData = userResult.rows[0];

    // 2. จัดกลุ่มเพื่อใช้ดึง % หลักสูตร และ กรอง Component ของกราฟ
    const typeStr = (userData.user_type || "").toLowerCase();
    let targetGroup = 3;
    let componentRole = "user"; // ตัวแปรสำหรับกรองกราฟเรดาร์

    if (typeStr.includes("regulator") || typeStr.includes("policy")) {
      targetGroup = 1;
      componentRole = "regulator";
    } else if (
      typeStr.includes("provider") ||
      typeStr.includes("developer") ||
      typeStr.includes("researcher")
    ) {
      targetGroup = 2;
      componentRole = "researcher"; // แมปให้ตรงกับชื่อ role ในตาราง components ของคุณ
    }

    // 3. ดึงสถิติด่วนสำหรับ Card Summary
    const statsQuery = `
      SELECT 
        COALESCE(SUM(up.attempt_count), 0) AS "totalAttempts",
        COUNT(CASE WHEN up.is_passed = true THEN 1 END) AS "passedChapters",
        (SELECT COUNT(*) FROM certificates WHERE user_id = $1) AS "certificatesCount"
      FROM user_progress up
      WHERE up.user_id = $1
    `;
    const statsResult = await db.query(statsQuery, [userId]);
    const summaryStats = statsResult.rows[0];

    // 4. คำนวณเปอร์เซ็นต์ความคืบหน้าหลักสูตร
    const totalChaptersQuery = `SELECT COUNT(*) AS total FROM chapters WHERE target_group = $1 AND status = 'Active'`;
    const totalChaptersResult = await db.query(totalChaptersQuery, [
      targetGroup,
    ]);
    const totalChapters = parseInt(totalChaptersResult.rows[0].total) || 0;
    const passedChapters = parseInt(summaryStats.passedChapters) || 0;
    const progressPercentage =
      totalChapters > 0
        ? Math.round((passedChapters / totalChapters) * 100)
        : 0;

    // 5. ดึงข้อมูลองค์ประกอบจริยธรรม (กรองเฉพาะของ User Type นั้นๆ)
    const componentRadarQuery = `
      SELECT 
        comp.id AS "componentId",
        comp.title AS "componentName",
        comp.max_maturity_level AS "maxMaturity", -- ดึงคะแนนเต็มของข้อนั้นมาด้วย
        COALESCE(
          (SELECT level_id FROM evaluation_guidelines WHERE user_type = u.user_type LIMIT 1), 
          0 -- ถ้ายังไม่เคยประเมินให้เริ่มที่ 0
        ) AS "maturityLevel"
      FROM components comp
      CROSS JOIN users u
      WHERE u.id = $1 AND LOWER(comp.role) = LOWER($2) -- กรองให้ตรงกับ Role ของผู้ใช้
      ORDER BY comp.id ASC
    `;
    const radarResult = await db.query(componentRadarQuery, [
      userId,
      componentRole,
    ]);

    res.status(200).json({
      success: true,
      data: {
        userId: userData.id,
        name: userData.first_name_th
          ? `${userData.first_name_th} ${userData.last_name_th}`
          : userData.username,
        userType: userData.user_type,
        organization: userData.org_name || "ไม่มีสังกัดหน่วยงาน",
        projects: userData.projects || "ยังไม่มีโครงการที่รับผิดชอบ",
        stats: {
          totalAttempts: parseInt(summaryStats.totalAttempts),
          passedChapters: passedChapters,
          certificates: parseInt(summaryStats.certificatesCount),
          progressPercentage: progressPercentage,
        },
        radarData: radarResult.rows,
      },
    });
  } catch (error) {
    console.error("Get User Dashboard Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลแดชบอร์ด",
    });
  }
};

// ==========================================
// ฟังก์ชัน: ดึงรายการสื่อการเรียนรู้ (Classroom)
// ==========================================
exports.getUserClassroom = async (req, res) => {
  try {
    const userId = req.params.id;

    // 1. ดึงประเภทของผู้ใช้เพื่อนำไปหากลุ่มหลักสูตร
    const userQuery = `SELECT user_type FROM users WHERE id = $1`;
    const userResult = await db.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบข้อมูลผู้ใช้งาน" });
    }

    const typeStr = (userResult.rows[0].user_type || "").toLowerCase();
    let targetGroup = 3; // ค่าเริ่มต้น (User)
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
      courseTitle = "หลักสูตรสำหรับนักพัฒนา (Researcher, Developer, Service Provider)";
      courseDesc =
        "เรียนรู้การออกแบบและพัฒนาโมเดล AI ที่มีความโปร่งใส อธิบายได้ และลดความลำเอียง";
    }

    // 2. ดึงรายการบทเรียนทั้งหมดในกลุ่มนั้น พร้อม JOIN ผลการสอบของผู้ใช้
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
    console.error("Get User Classroom Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลห้องเรียน",
    });
  }
};

// ==========================================
// ฟังก์ชัน: ดึงข้อมูลบทเรียน 1 บท (โดยใช้ lessonId) สำหรับหน้าเรียนวิดีโอ
// ==========================================
exports.getChapterById = async (req, res) => {
  try {
    const { id } = req.params;

    // 💡 แก้ไขแล้ว: ดึงเฉพาะ title และ video_url (ไม่มี content แล้วเพื่อป้องกัน Error)
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
    console.error("Get Chapter Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

exports.getUserTestsList = async (req, res) => {
  try {
    const userId = req.params.id;

    // หา User Type เพื่อระบุ Target Group
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

    // ดึงบทเรียนและผลคะแนนสอบ
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
    console.error("Get Tests List Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงรายการแบบทดสอบ",
    });
  }
};

exports.getTestQuestions = async (req, res) => {
  try {
    const { chapterId } = req.params;

    // ดึงข้อมูลบทเรียน
    const chapterQuery = `SELECT id, title, passing_percentage FROM chapters WHERE id = $1`;
    const chapterResult = await db.query(chapterQuery, [chapterId]);

    if (chapterResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "ไม่พบแบบทดสอบนี้" });
    }

    // ดึงคำถามจาก DB ตาม Schema จริงของคุณ
    const questionsQuery = `SELECT id, question_text, options, correct_answer FROM questions WHERE chapter_id = $1 ORDER BY id ASC`;
    const questionsResult = await db.query(questionsQuery, [chapterId]);

    // แปลงข้อมูลและสลับช้อยส์ (Shuffle Options)
    const formattedQuestions = questionsResult.rows.map((q) => {
      // ป้องกันกรณี options เป็น string ต้อง parse เป็น array ก่อน
      const optionsArray =
        typeof q.options === "string" ? JSON.parse(q.options) : q.options;

      // หา Text ของคำตอบที่ถูกต้องก่อนสลับตำแหน่ง
      const correctIndexDB = parseInt(q.correct_answer, 10) || 0;
      const correctText = optionsArray[correctIndexDB];

      // สลับตำแหน่งช้อยส์ (Fisher-Yates Shuffle)
      let shuffledOptions = [...optionsArray];
      for (let i = shuffledOptions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledOptions[i], shuffledOptions[j]] = [
          shuffledOptions[j],
          shuffledOptions[i],
        ];
      }

      // หา Index ใหม่ของคำตอบที่ถูกต้องหลังจากสลับแล้ว
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
    console.error("Get Questions Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการดึงคำถาม" });
  }
};

exports.submitTestResult = async (req, res) => {
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

      // ดึงการตั้งค่าแม่แบบของกลุ่มนี้แนบกลับไปด้วย
      const settingsQuery = await db.query(
        `SELECT * FROM certificate_settings WHERE course_group = $1`,
        [courseGroupId],
      );
      certSettings = settingsQuery.rows[0] || {};
      certSettings.certId = certId; // แนบไอดีกลับไปเพื่อทำรหัส
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
    console.error("Submit Test Error:", error);
    res.status(500).json({ success: false, message: "บันทึกผลสอบไม่สำเร็จ" });
  }
};

exports.getToolSetupData = async (req, res) => {
  try {
    // เช็คว่าผู้ใช้ที่ล็อกอินอยู่มีหน่วยงานสังกัดหรือไม่ (ดึงจาก JWT ที่ verify แล้วเท่านั้น)
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
      // มีหน่วยงานสังกัด -> ใช้ Maturity Level เหมือนเดิม
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

    // ไม่มีหน่วยงานสังกัด -> ใช้ Impact Level แทน
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
    console.error("Get Tool Setup Error:", error);
    res
      .status(500)
      .json({ success: false, message: "ดึงข้อมูลตั้งต้นไม่สำเร็จ" });
  }
};

// ==========================================
// 2. ฟังก์ชัน: ประมวลผลและสร้างเครื่องมือประเมิน (บันทึกลง Database - JSONB)
// ==========================================
exports.generateToolResult = async (req, res) => {
  try {
    const { userId, maturityId, principleIds } = req.body;

    // 1. ดึงข้อมูล User Type + หน่วยงานสังกัด
    const userResult = await db.query(
      "SELECT user_type, organization_id FROM users WHERE id = $1",
      [userId],
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "ไม่พบ User" });
    }
    const userType = userResult.rows[0].user_type || "user";
    const hasOrganization = userResult.rows[0].organization_id !== null;

    // ถ้าไม่มีหน่วยงานสังกัด: maturityId ที่ส่งมาคือ Impact Level ID
    // ต้องแปลงเป็น Maturity Level (base_maturity_level) ก่อน เพื่อให้ query ที่เหลือทำงานเหมือนเดิมทุกจุด
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

    // 2. แปลง User Type เป็น Role สำหรับดึง Components
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

    // 3. ดึง Components ที่เกี่ยวข้อง
    const compQuery = `
      SELECT DISTINCT c.id, c.title, c.max_maturity_level
      FROM components c
      JOIN component_principles cp ON c.id = cp.component_id
      WHERE LOWER(c.role) = LOWER($1) AND cp.principle_id = ANY($2::varchar[])
      ORDER BY c.id ASC
    `;
    const components = await db.query(compQuery, [roleStr, principleIds]);

    // 4. ดึงข้อมูล Guidelines แบบภาพรวม
    const guideQuery = `
      SELECT analysis, strengths, gaps, risks, recommendations, roadmap 
      FROM evaluation_guidelines 
      WHERE LOWER(user_type) = LOWER($1) AND level_id = $2
    `;
    const guidelines = await db.query(guideQuery, [userType, actualMaturityId]);

    // 5. ดึงข้อมูลรายละเอียดของ Maturity และ Principles
    const matInfo = await db.query(
      "SELECT level_id, level_name, description FROM maturity_levels WHERE level_id = $1",
      [actualMaturityId],
    );
    const prinInfo = await db.query(
      "SELECT id, name, description FROM principles WHERE id = ANY($1::varchar[])",
      [principleIds],
    );

    // 6. ประกอบก้อน Object ผลลัพธ์ที่จะจัดเก็บลง JSONB
    const resultSnapshot = {
      userType: userType,
      matchedRole: roleStr,
      date: new Date().toLocaleDateString("th-TH"),
      maturity: matInfo.rows[0],
      impact: impactInfo, // จะมีค่าเฉพาะกรณีไม่มีหน่วยงานสังกัด (ใช้ Impact Level แทน)
      principles: prinInfo.rows,
      components: components.rows,
      guideline: guidelines.rows.length > 0 ? guidelines.rows[0] : null,
    };

    // 7. บันทึกลงตาราง ประวัติ user_tools_history ในรูปแบบ JSONB ถาวร (เก็บเป็น maturity_id จริงเสมอ เพื่อให้รายงาน/สถิติอื่นใช้ร่วมกันได้)
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
    console.error("Generate Tool Error:", error);
    res
      .status(500)
      .json({ success: false, message: "สร้างเครื่องมือประเมินไม่สำเร็จ" });
  }
};

// ==========================================
// 3. ฟังก์ชัน: ดึงประวัติเครื่องมือประเมินทั้งหมดจากฐานข้อมูลจริง
// ==========================================
exports.getUserToolsHistoryList = async (req, res) => {
  try {
    const userId = req.params.id;

    // ดึงข้อมูล id ประวัติ และดึงก้อนข้อมูลจากฟิลด์ result_data ออกมาตรงๆ
    const query = `
      SELECT id, result_data 
      FROM user_tools_history 
      WHERE user_id = $1 
      ORDER BY id DESC
    `;
    const result = await db.query(query, [userId]);

    // จัด Format ส่งกลับไปหน้าบ้าน
    const formattedData = result.rows.map((row) => ({
      id: row.id,
      ...row.result_data, // แตกกระจายก้อน JSONB ออกมาเป็นข้อมูลระนาบเดียวกัน
    }));

    res.status(200).json({ success: true, data: formattedData });
  } catch (error) {
    console.error("Get Tools History List Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงประวัติการประเมิน",
    });
  }
};

// ==========================================
// 4. ฟังก์ชัน: ลบประวัติเครื่องมือประเมินออกจากฐานข้อมูล
// ==========================================
exports.deleteUserToolHistory = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query("DELETE FROM user_tools_history WHERE id = $1", [id]);
    res
      .status(200)
      .json({ success: true, message: "ลบประวัติการประเมินสำเร็จ" });
  } catch (error) {
    console.error("Delete Tool History Error:", error);
    res.status(500).json({ success: false, message: "ลบข้อมูลไม่สำเร็จ" });
  }
};

exports.getUserCertificates = async (req, res) => {
  try {
    const { userId } = req.params;

    // Join เอาตาราง certificate_settings มาด้วยเลย
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
    console.error("Get Certificates Error:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "เกิดข้อผิดพลาดในการดึงใบประกาศนียบัตร",
      });
  }
};

// ดึงรายการ Activities ของ Component หนึ่งๆ (ใช้แสดงในป็อปอัพหน้าผลการประเมิน)
exports.getComponentActivitiesList = async (req, res) => {
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
    console.error("Get Component Activities List Error:", error);
    res.status(500).json({
      success: false,
      message: "เกิดข้อผิดพลาดในการดึงข้อมูล Activities",
    });
  }
};
