-- วันที่อบรมออนไซต์ + ลิงก์ ที่ผู้ใช้ส่งเอง (ส่งได้ไม่เกิน 2 วันต่อคน คุมที่ชั้น API)
-- รันกับทุก environment (Neon / UAT / PRD) ก่อน deploy โค้ดชุดนี้
CREATE TABLE IF NOT EXISTS user_onsite_submissions (
  id            SERIAL PRIMARY KEY,
  account_id    INTEGER NOT NULL,
  training_date DATE NOT NULL,
  url           TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, training_date)
);

-- ตารางเก่าจากเวอร์ชันก่อนหน้า (ถ้าเคยรันไว้) ไม่ได้ใช้แล้ว:
-- DROP TABLE IF EXISTS user_onsite_links;
-- DROP TABLE IF EXISTS onsite_links;
