-- ตารางรุ่นของ "ทำเนียบรุ่น" - แอดมินกำหนดชื่อรุ่นและช่วงวันที่ ผู้ที่ออกใบประกาศฯ (certificates.issued_at)
-- อยู่ในช่วงวันที่ของรุ่นไหนจะถูกนับเป็นผู้จบของรุ่นนั้น (ไม่มีตารางเชื่อมเพิ่ม)
-- รันกับทุก environment (Neon / UAT / PRD) ก่อน deploy โค้ดชุดนี้
CREATE TABLE IF NOT EXISTS alumni_batches (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  description TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT alumni_batches_date_range CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS idx_alumni_batches_start_date ON alumni_batches (start_date);
