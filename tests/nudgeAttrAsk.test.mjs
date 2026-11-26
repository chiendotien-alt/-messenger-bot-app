// Lỗi 26/11/2026: khách hỏi vòng bụng 104cm, bot trả lời xong; ~2 phút sau tin bồi nhờ AI viết "câu chốt" và AI hỏi
// "Chị chọn giúp em màu và chiều dài váy chị muốn lấy ạ?" (bỏ qua bước xin chiều cao cân nặng).
import test from "node:test";
import assert from "node:assert/strict";
import { composeNudge } from "../lib/nudge.js";

const product = {
  id: "1", name: "Chân váy 3 tầng", description: "", notes: "", openingScript: "",
  attributes: [
    { name: "Size", values: "S, M, L, XL, 2XL", how: "Theo cân nặng S: 37-46kg M:47–53kg L: 54–60kg XL: 61–67kg 2XL: 68–75kg", ask: "Em xin cân nặng để chọn size váy a?" },
    { name: "Chiều dài váy", values: "75cm, 85cm, 92cm", how: "Theo chiều cao 75cm:phù hợp khách cao từ 1m40 đến 1m50. 85cm: phù hợp khách cao từ 1m51 đến 1m64. 92cm: phù hợp khách cao từ 1m65 trở lên.", ask: "Em xin chiều cao để chọn chiều dài váy nha chị?" },
    { name: "màu", values: "Trắng, Đen, Kem, Vàng, Xanh, Hồng, Đỏ đô, Cam Đất", how: "Khách tự chọn hoặc khách bảo tư vấn", ask: "Chị đã chọn được màu chân váy nào bên em chưa ạ?" },
  ],
  attributeGroups: [{ name: "Bộ kích thước", members: ["Size", "Chiều dài váy"], ask: "Chị cho em xin chiều cao cân nặng để em chọn váy nha?" }],
};
const C = (t) => ({ from: "customer", text: t });
const B = (t) => ({ from: "bot", text: t });
const answer = "Dạ, chân váy bên em cạp chun co giãn thoải mái nên vòng bụng 104cm mình mặc vẫn vừa ạ.";

async function nudge(msgs, { lines = [], recentOut, info = {} } = {}) {
  let aiCalled = false;
  const io = {
    getRecentMessages: async () => msgs,
    getCustomerInfo: async () => info,
    getRecentOutgoingWithAge: async () => recentOut ?? msgs.filter((m) => m.from === "bot").map((m) => ({ text: m.text, ageMs: 200000 })).reverse(),
    getCustomerName: async () => "Dung",
    askGeminiJson: async () => { aiCalled = true; return JSON.stringify({ skip: false, type: "close", message: "Chị chọn giúp em màu và chiều dài váy chị muốn lấy ạ?" }); },
  };
  const r = await composeNudge({ id: "c", name: "Dung", pageId: "p", productId: "1", hasPhone: false }, lines, ["k"], [product], "", 5000, io);
  return { message: r.message || "", skip: !!r.skip, aiCalled };
}

const chat = [B("Giá váy bên em: 1 váy: 195K"), B("Bên trên em có gửi ảnh màu và bảng chọn size - chiều dài váy"), C("Vòng bụng 104cm mặc vừa không shop"), B(answer)];
const onlyAnswer = [{ text: answer, ageMs: 200000 }]; // các tin gần nhất của shop không có câu hỏi nào

test("LỖI THẬT: shop chưa hỏi gì gần đây, khách chưa có chiều cao cân nặng → bồi xin chiều cao cân nặng, không nhờ AI", async () => {
  const r = await nudge(chat, { recentOut: onlyAnswer });
  assert.match(r.message, /chiều cao cân nặng/);
  assert.doesNotMatch(r.message, /màu và chiều dài/);
  assert.equal(r.aiCalled, false);
});

test("có câu chốt chủ shop cài sẵn cũng không dùng khi khách còn thiếu mục", async () => {
  const r = await nudge(chat, { recentOut: onlyAnswer, lines: ["Chị chọn giúp em màu và chiều dài váy chị muốn lấy ạ?"] });
  assert.match(r.message, /chiều cao cân nặng/);
});

test("khách đã nói chiều cao cân nặng (size, chiều dài có), còn thiếu màu → bồi hỏi màu", async () => {
  const msgs = [...chat, C("Cao 1m50 nặng 53kg"), B("Dạ chị cao 1m50 nặng 53kg thì mặc size M, chân váy dài 75cm là vừa đẹp ạ.")];
  const r = await nudge(msgs, { recentOut: [{ text: "Dạ chị cao 1m50 nặng 53kg thì mặc size M, chân váy dài 75cm là vừa đẹp ạ.", ageMs: 200000 }] });
  assert.match(r.message, /màu/);
  assert.doesNotMatch(r.message, /chiều cao|cân nặng/);
  assert.equal(r.aiCalled, false);
});

test("đã đủ màu/size/chiều dài mà chưa có SĐT → vẫn xin SĐT + địa chỉ như cũ", async () => {
  const msgs = [...chat, C("Cao 1m50 nặng 53kg"), B("Dạ chị mặc size M, dài 75cm ạ."), C("Lấy màu đen")];
  const r = await nudge(msgs, { recentOut: [{ text: "Dạ vâng ạ.", ageMs: 200000 }] });
  assert.match(r.message, /số điện thoại/);
});
