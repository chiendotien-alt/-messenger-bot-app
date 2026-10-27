// /api/keys/alert-test — bấm vào đường dẫn này (đăng nhập như vào trang quản trị) để gửi thử 1 tin báo lỗi về Telegram.
import { reportError, sendTelegram } from "@/lib/alert";

export const dynamic = "force-dynamic";

const text = (s) => new Response(s, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function GET() {
  const missing = [];
  if (!process.env.TELEGRAM_BOT_TOKEN) missing.push("TELEGRAM_BOT_TOKEN");
  if (!process.env.TELEGRAM_CHAT_ID) missing.push("TELEGRAM_CHAT_ID");
  if (missing.length) {
    return text(`❌ Chưa cài xong: còn thiếu biến ${missing.join(" và ")} trên Vercel.\nThêm xong nhớ bấm Redeploy rồi mở lại đường dẫn này.`);
  }
  const ok = await reportError("test", "TEST — hệ thống báo lỗi đang hoạt động", { "Ghi chú": "Nếu bạn đọc được tin này trên Telegram là đã cài đúng." }, { gapMs: 0 });
  if (ok) return text("✅ Đã gửi tin thử — mở Telegram xem có tin từ bot không.");
  const r = await sendTelegram("test");
  return text(
    `❌ Gửi không được. Telegram báo: ${r.description || "không rõ"}\n` +
      "Hay gặp: (1) chưa mở bot và bấm Start, (2) sai TELEGRAM_CHAT_ID, (3) sai TELEGRAM_BOT_TOKEN."
  );
}
