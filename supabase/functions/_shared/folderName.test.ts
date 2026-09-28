import { assertEquals } from "jsr:@std/assert@1";
import { folderNameIssues } from "./folderName.ts";

Deno.test("accepts every date form", () => {
  for (const name of [
    "20260315 Troodos Hike",
    "20260315-16 Troodos Hike",
    "20260330-0402 Easter Camp",
    "20261230-20270102 NewYear Trip",
    "20260315 TroodosHike",
    "20260315 Akamas 4x4 Tour",
  ]) assertEquals(folderNameIssues(name, "2026"), [], name);
});

Deno.test("flags names that break the convention", () => {
  const has = (name: string, text: string, year = "2026") =>
    assertEquals(folderNameIssues(name, year).some((i) => i.includes(text)), true, `${name} → ${text}`);
  has("Troodos Hike", "Start with the date");
  has("2026-03-15 Troodos", "Start with the date");
  has("20260315-Troodos Hike", "single space");
  has("20260315 - Troodos Hike", "single space");
  has("20260315 Troodos-Hike", "Do not use “-”");
  has("20260315 troodos hike", "CamelCase");
  has("20260315  Troodos", "single spaces");
  has("20260231 Troodos", "not a real date");
  has("20260315-14 Troodos", "before the start");
  has("20250315 Troodos", "should be in 2026");
  has("20260315", "Add the activity name");
});
