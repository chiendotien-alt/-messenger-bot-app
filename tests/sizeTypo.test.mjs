import test from "node:test";
import assert from "node:assert/strict";
import { matchValues } from "../lib/attributes.js";

const attr = { name: "Size", key: "size", values: ["S", "M", "L", "XL"], kind: "pair" };

test("khách gõ 'zai l' / 'sai l' / 'cỡ L' trong tin dài vẫn nhận size L", () => {
  for (const t of [
    "Chị lấy Màu kem zai l dài váy 75 cm",
    "Chị lấy màu kem sai l dài váy 75cm",
    "chị lấy màu kem cỡ L dài váy 75cm nha em",
  ]) assert.deepEqual(matchValues(attr, t), ["L"], t);
});

test("không nhầm size khi không nói size", () => {
  assert.deepEqual(matchValues(attr, "Chị lấy màu kem dài váy 75 cm giao về Hà Nội nhé em"), []);
});
