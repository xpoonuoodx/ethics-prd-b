const fs = require("fs");
const path = require("path");
const db = require("../db");
const { generateCertNumber } = require("../utils/certNumber");
const { getTargetGroupFromUserType } = require("../utils/targetGroup");
const { getAppSettings } = require("../utils/appSettings");
const { isValidPhone } = require("../utils/validators");
const { UPLOAD_DIR } = require("../utils/uploadMiddleware");

// --- GET USER DASHBOARD DATA ---
exports.getUserDashboard = async (req, res) => {
  try {
    const userId = req.params.id;

    // กันไม่ให้ user คนอื่นเปลี่ยนเลข id ใน URL แล้วดูแดชบอร์ดของคนอื่นได้ (IDOR)
    if (parseInt(userId, 10) !== (req.user.account_id || req.user.id)) {
      return res
        .status(403)
        .json({ success: false, message: "ไม่มีสิทธิ์เข้าถึงข้อมูลนี้" });
    }

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

    // 4. คำนวณเปอร์เซ็นต์ความคืบหน้าหลักสูตร (ต้องนับเฉพาะบทที่ผ่านของหลักสูตรตัวเองเท่านั้น
    // แยกจาก summaryStats.passedChapters ด้านบนซึ่งเป็นยอดรวมทุกหลักสูตรที่เคยสอบผ่าน (ใช้โชว์
    // การ์ดสรุปรวม "บทเรียนที่สอบผ่าน" เฉยๆ) - ถ้าใช้ยอดรวมมาหารจะได้ % เกิน 100 ได้ตอนที่เปิดโหมด
    // "ทำแบบทดสอบข้ามหลักสูตร" แล้วผู้ใช้ไปสอบผ่านหลักสูตรอื่นเพิ่มด้วย)
    const totalChaptersQuery = `SELECT COUNT(*) AS total FROM chapters WHERE target_group = $1 AND status = 'Active'`;
    const totalChaptersResult = await db.query(totalChaptersQuery, [
      targetGroup,
    ]);
    const totalChapters = parseInt(totalChaptersResult.rows[0].total) || 0;
    const ownPassedQuery = `
      SELECT COUNT(*) AS "ownPassedChapters"
      FROM user_progress up
      JOIN chapters c ON up.chapter_id = c.id
      WHERE up.user_id = $1 AND up.is_passed = true AND c.target_group = $2
    `;
    const ownPassedResult = await db.query(ownPassedQuery, [
      userId,
      targetGroup,
    ]);
    const ownPassedChapters =
      parseInt(ownPassedResult.rows[0].ownPassedChapters) || 0;
    const progressPercentage =
      totalChapters > 0
        ? Math.round((ownPassedChapters / totalChapters) * 100)
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

    // ถ้า admin เปิดโหมด "ทำแบบทดสอบข้ามหลักสูตร" ไว้ คำนวณ % ความคืบหน้าของอีก 2 หลักสูตร
    // ที่ไม่ใช่ของตัวเองมาด้วย เพื่อให้หน้า Dashboard โชว์ progress bar ได้ครบทั้ง 3 การ์ด
    // (ปิดโหมดนี้ = เหมือนเดิมทุกอย่าง โชว์ progress แค่การ์ดของหลักสูตรตัวเอง)
    const { allow_cross_track_testing } = await getAppSettings();
    let groupProgress = null;
    if (allow_cross_track_testing) {
      const allGroupsStatsQuery = `
        SELECT
          c.target_group AS "targetGroup",
          COUNT(*) AS "totalChapters",
          COUNT(CASE WHEN up.is_passed = true THEN 1 END) AS "passedChapters"
        FROM chapters c
        LEFT JOIN user_progress up ON up.chapter_id = c.id AND up.user_id = $1
        WHERE c.status = 'Active'
        GROUP BY c.target_group
      `;
      const allGroupsResult = await db.query(allGroupsStatsQuery, [userId]);
      groupProgress = { 1: 0, 2: 0, 3: 0 };
      allGroupsResult.rows.forEach((row) => {
        const total = parseInt(row.totalChapters) || 0;
        const passed = parseInt(row.passedChapters) || 0;
        groupProgress[row.targetGroup] =
          total > 0 ? Math.round((passed / total) * 100) : 0;
      });
      // แถวของหลักสูตรตัวเองใช้ค่าที่คำนวณไว้แล้วด้านบนเป๊ะ ๆ (กันเคสปัดเศษไม่ตรงกันเล็กน้อย)
      groupProgress[targetGroup] = progressPercentage;
    }

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
          passedChapters: parseInt(summaryStats.passedChapters) || 0,
          certificates: parseInt(summaryStats.certificatesCount),
          progressPercentage: progressPercentage,
        },
        radarData: radarResult.rows,
        allowCrossTrackTesting: allow_cross_track_testing,
        groupProgress,
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

    // กันไม่ให้ user คนอื่นเปลี่ยนเลข id ใน URL แล้วดูห้องเรียนของคนอื่นได้ (IDOR)
    if (parseInt(userId, 10) !== (req.user.account_id || req.user.id)) {
      return res
        .status(403)
        .json({ success: false, message: "ไม่มีสิทธิ์เข้าถึงข้อมูลนี้" });
    }

    // เรียนได้ทุกหลักสูตรไม่ว่าจะเป็น user_type ไหน (การทำข้อสอบเท่านั้นที่ยังจำกัดตาม
    // user_type เดิม ดู getUserTestsList/submitTestResult) เลยดึงบทเรียนทุกกลุ่มมาให้หมด
    // แล้วจัดเป็นชุดหลักสูตรแยกตามกลุ่มไว้ให้หน้าบ้าน render เป็นหัวข้อ ๆ
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

    // 💡 แก้ไขแล้ว: ดึงเฉพาะ title, video_url และ target_group (ไม่มี content แล้วเพื่อป้องกัน Error)
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
    console.error("Get Chapter Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

exports.getUserTestsList = async (req, res) => {
  try {
    const userId = req.params.id;

    // กันไม่ให้ user คนอื่นเปลี่ยนเลข id ใน URL แล้วดูรายการแบบทดสอบของคนอื่นได้ (IDOR)
    if (parseInt(userId, 10) !== (req.user.account_id || req.user.id)) {
      return res
        .status(403)
        .json({ success: false, message: "ไม่มีสิทธิ์เข้าถึงข้อมูลนี้" });
    }

    // หา User Type เพื่อระบุ Target Group
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

    // ดึงคำถามจาก DB ตาม Schema จริงของคุณ
    const questionsQuery = `SELECT id, question_text, options, correct_answer FROM questions WHERE chapter_id = $1 ORDER BY id ASC`;
    const questionsResult = await db.query(questionsQuery, [chapterId]);

    // แปลงข้อมูลและสลับช้อยส์ (Shuffle Options)
    const formattedQuestions = questionsResult.rows.map((q) => {
      // ป้องกันกรณี options เป็น string ต้อง parse เป็น array ก่อน
      const optionsArray =
        typeof q.options === "string" ? JSON.parse(q.options) : q.options;

      // สลับตำแหน่งช้อยส์ (Fisher-Yates Shuffle)
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
      // ดู submitTestResult ด้านล่าง

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
    console.error("Get Questions Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการดึงคำถาม" });
  }
};

exports.submitTestResult = async (req, res) => {
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

      // ดึงการตั้งค่าแม่แบบของกลุ่มนี้แนบกลับไปด้วย
      const settingsQuery = await db.query(
        `SELECT * FROM certificate_settings WHERE course_group = $1`,
        [courseGroupId],
      );
      certSettings = settingsQuery.rows[0] || {};
      certSettings.certId = certId; // แนบไอดีกลับไปเพื่อทำรหัส (เผื่อใบเก่าที่ยังไม่มี cert_number)
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
    // ผู้ใช้ต้องสร้างผลประเมินให้ตัวเองเท่านั้น (ห้ามรับ userId จาก body เพราะสร้างแทนคนอื่นได้)
    const userId = req.user.account_id || req.user.id;
    const { maturityId, principleIds } = req.body;

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
      date: new Date().toLocaleDateString("th-TH", {
        timeZone: "Asia/Bangkok",
      }),
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

    // กันไม่ให้ user คนอื่นเปลี่ยนเลข id ใน URL แล้วดูประวัติประเมินของคนอื่นได้ (IDOR)
    if (parseInt(userId, 10) !== (req.user.account_id || req.user.id)) {
      return res
        .status(403)
        .json({ success: false, message: "ไม่มีสิทธิ์เข้าถึงข้อมูลนี้" });
    }

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
    console.error("Delete Tool History Error:", error);
    res.status(500).json({ success: false, message: "ลบข้อมูลไม่สำเร็จ" });
  }
};

exports.getUserCertificates = async (req, res) => {
  try {
    const { userId } = req.params;

    // กันไม่ให้ user คนอื่นเปลี่ยนเลข id ใน URL แล้วดูใบเซอร์ของคนอื่นได้ (IDOR)
    if (parseInt(userId, 10) !== (req.user.account_id || req.user.id)) {
      return res
        .status(403)
        .json({ success: false, message: "ไม่มีสิทธิ์เข้าถึงข้อมูลนี้" });
    }

    // Join เอาตาราง certificate_settings มาด้วยเลย
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

// ==========================================
// หน้า "ข้อมูลส่วนตัว" (Profile) - ดูและแก้ไขข้อมูลของตัวเองเท่านั้น
// ==========================================
exports.getUserProfile = async (req, res) => {
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
    console.error("Get User Profile Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการดึงข้อมูลส่วนตัว" });
  }
};

exports.updateUserProfile = async (req, res) => {
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
    console.error("Update User Profile Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการบันทึกข้อมูลส่วนตัว" });
  }
};

// อัปโหลด/เปลี่ยนรูปโปรไฟล์ (แยก endpoint จาก updateUserProfile เพราะเป็น multipart/form-data
// ไม่ใช่ JSON) - middleware อัปโหลดไฟล์อยู่ที่ routes/userRoutes.js
exports.uploadUserProfileImage = async (req, res) => {
  try {
    const userId = req.user.account_id || req.user.id;

    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "กรุณาเลือกไฟล์รูปภาพ" });
    }

    const imageUrl = `${process.env.MYAPP_BACKEND_URL}/uploads/profile-images/${req.file.filename}`;

    // ดึง URL รูปเดิมไว้ก่อน เผื่อต้องลบไฟล์เก่าทิ้งจาก disk หลังอัปเดตสำเร็จ (กันไฟล์ขยะสะสม)
    const oldResult = await db.query(
      "SELECT profile_image_url FROM profiles WHERE user_id = $1",
      [userId],
    );
    const oldImageUrl = oldResult.rows[0]?.profile_image_url;

    await db.query(
      "UPDATE profiles SET profile_image_url = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2",
      [imageUrl, userId],
    );

    // ลบไฟล์เก่าทิ้งเฉพาะกรณีเป็นไฟล์ที่เราเก็บไว้เอง (ไม่ใช่ URL รูปจาก LINE ที่ไม่ได้อยู่บน
    // disk ของเรา ลบไม่ได้และไม่ควรไปยุ่งด้วย)
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
    console.error("Upload User Profile Image Error:", error);
    res
      .status(500)
      .json({ success: false, message: "เกิดข้อผิดพลาดในการอัปโหลดรูป" });
  }
};
