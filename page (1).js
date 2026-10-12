import { redirect } from "next/navigation";

// Trang chat giờ là trang chính /admin; giữ đường dẫn cũ để link cũ vẫn dùng được
export default function OldChatPage() {
  redirect("/admin");
}
