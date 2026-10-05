// ปิดบังชื่อ-นามสกุลสำหรับหน้าทำเนียบรุ่น (Public) เช่น "สมชาย" -> "สม***"
// ตัดตามหน่วยตัวอักษรที่คนเห็น (grapheme) ไม่ใช่ตามจำนวน code point เพราะสระ/วรรณยุกต์ภาษาไทย
// เป็นตัวอักษรแยกกัน ถ้านับตรง ๆ จะตัดกลางพยัญชนะ+สระจนอ่านไม่ออก
const segmenter = new Intl.Segmenter("th", { granularity: "grapheme" });

// สระหน้า: ต้องอยู่คู่กับพยัญชนะตัวถัดไป ห้ามตัดให้เหลือแค่ "เ***"
const LEADING_VOWELS = new Set(["เ", "แ", "โ", "ใ", "ไ"]);

const MAX_VISIBLE = 5;

const maskName = (name) => {
  const graphemes = Array.from(segmenter.segment((name || "").trim()), (s) => s.segment);
  const total = graphemes.length;
  if (total === 0) return "";

  // โชว์ประมาณ 40% ของชื่อ (อย่างน้อย 2 ตัว) และเหลือส่วนที่ปิดไว้เสมอ
  let visible = Math.min(Math.max(2, Math.round(total * 0.4)), MAX_VISIBLE, total - 1);
  visible = Math.max(visible, 1);

  if (LEADING_VOWELS.has(graphemes[visible - 1]) && visible < total) {
    visible += 1;
  }

  return `${graphemes.slice(0, visible).join("")}***`;
};

module.exports = { maskName };
