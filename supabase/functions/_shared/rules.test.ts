import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  classifyFolder, isDuplicate, isMediaMime, isOperatorEmail, isYearFolderName, nextChunk, sortYearFolders, validateFolderName,
} from "./rules.ts";

Deno.test("operator emails are limited to the workspace domain", () => {
  assertEquals(isOperatorEmail("Anna@ActiveZoneOutdoor.cy"), true);
  assertEquals(isOperatorEmail("anna@gmail.com"), false);
  assertEquals(isOperatorEmail("anna@activezoneoutdoor.cy.evil.com"), false);
  assertEquals(isOperatorEmail(undefined), false);
});

Deno.test("media types", () => {
  assertEquals(isMediaMime("image/jpeg"), true);
  assertEquals(isMediaMime("image/heic"), true);
  assertEquals(isMediaMime("video/mp4"), true);
  assertEquals(isMediaMime("image/svg+xml"), false);
  assertEquals(isMediaMime("application/pdf"), false);
  assertEquals(isMediaMime("audio/mpeg"), false);
});

Deno.test("folder classification", () => {
  assertEquals(classifyFolder(0, false), "upcoming");
  assertEquals(classifyFolder(3, false), "pending");
  assertEquals(classifyFolder(3, true), "pending");
  assertEquals(classifyFolder(0, true), "done");
});

Deno.test("folder names are trimmed and validated", () => {
  assertEquals(validateFolderName("  Troodos   hike 2026 "), "Troodos hike 2026");
  assertThrows(() => validateFolderName("   "));
  assertThrows(() => validateFolderName(42));
  assertThrows(() => validateFolderName("x".repeat(501)));
});

Deno.test("chunk planning", () => {
  assertEquals(nextChunk(0, 10, 4), { offset: 0, end: 4, final: false });
  assertEquals(nextChunk(8, 10, 4), { offset: 8, end: 10, final: true });
  assertEquals(nextChunk(0, 3, 4), { offset: 0, end: 3, final: true });
  assertEquals(nextChunk(12, 10, 4), { offset: 10, end: 10, final: true });
});

Deno.test("duplicates by Drive id or checksum", () => {
  const file = { id: "a", name: "IMG_1.jpg", mimeType: "image/jpeg", size: 10, md5: "m1" };
  assertEquals(isDuplicate(file, []), false);
  assertEquals(isDuplicate(file, [{ driveFileId: "a" }]), true);
  assertEquals(isDuplicate(file, [{ driveFileId: "b", md5: "m1" }]), true);
  assertEquals(isDuplicate(file, [{ driveFileId: "b", md5: "m2" }]), false);
  assertEquals(isDuplicate({ ...file, md5: undefined }, [{ driveFileId: "b", md5: null }]), false);
});

Deno.test("year folders are detected and sorted newest first", () => {
  assertEquals(isYearFolderName("2026"), true);
  assertEquals(isYearFolderName(" 2025 "), true);
  assertEquals(isYearFolderName("Archive"), false);
  assertEquals(isYearFolderName("2026 trips"), false);
  const sorted = sortYearFolders([{ name: "2024" }, { name: "Misc" }, { name: "2026" }, { name: "2025" }]);
  assertEquals(sorted.map((f) => f.name), ["2026", "2025", "2024"]);
});
