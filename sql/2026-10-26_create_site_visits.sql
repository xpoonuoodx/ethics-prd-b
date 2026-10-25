-- ตารางนับการเข้าหน้าโฮม (1 แถว = 1 การเข้าชม ต่อ 1 session ของเบราว์เซอร์)
-- visitor_id คือรหัสสุ่มที่เบราว์เซอร์สร้างเอง ใช้นับจำนวนผู้เข้าชมไม่ซ้ำ ไม่ได้ผูกกับบัญชีผู้ใช้
-- รันกับทุก environment (Neon / UAT / PRD) ก่อน deploy โค้ดชุดนี้
CREATE TABLE IF NOT EXISTS site_visits (
  id          BIGSERIAL PRIMARY KEY,
  visitor_id  VARCHAR(64) NOT NULL,
  visited_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_visits_visited_at ON site_visits (visited_at);
CREATE INDEX IF NOT EXISTS idx_site_visits_visitor_id ON site_visits (visitor_id);
