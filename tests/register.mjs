// Cho phép import không đuôi .js (Next.js cho phép, Node thuần thì không) để chạy test bằng `node --test`.
import { register } from "node:module";
register("./loader.mjs", import.meta.url);
