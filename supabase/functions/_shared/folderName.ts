// Activity folder naming convention. No imports: shared by the Edge Functions and the web app.
//
//   <date> <Title>
//   date:  YYYYMMDD | YYYYMMDD-DD | YYYYMMDD-MMDD | YYYYMMDD-YYYYMMDD
//   title: CamelCase words separated by single spaces, e.g. "20260315-16 Troodos Hike";
//          "the", "in", "at", "of", "n" and "&" may appear after the first word, e.g. "20260315 Sunset at the Lake";
//          "-" may join words in the name (e.g. "Rock-n-Roll") but never directly follow the date

// Lowercase connector words allowed between CamelCase words (not as the first word).
const connectors = new Set(["the", "in", "at", "of", "n", "&"]);

const datePattern = /^(\d{8})(?:-(\d{2}|\d{4}|\d{8}))?(?=\s|-|$)/;

function parseDate(value: string): Date | null {
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(4, 6));
  const d = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

/** Problems with an activity folder name; empty when it follows the convention. */
export function folderNameIssues(rawName: string, year?: string): string[] {
  const name = rawName.trim();
  const issues: string[] = [];
  const match = name.match(datePattern);
  if (!match) {
    return ["Start with the date: YYYYMMDD, YYYYMMDD-DD, YYYYMMDD-MMDD or YYYYMMDD-YYYYMMDD."];
  }

  const [datePart, start, suffix] = match;
  const startDate = parseDate(start);
  let endDate: Date | null = startDate;
  if (suffix) {
    endDate = parseDate(suffix.length === 8 ? suffix : start.slice(0, 8 - suffix.length) + suffix);
  }
  if (!startDate || !endDate) {
    issues.push(`“${datePart}” is not a real date.`);
  } else if (endDate < startDate) {
    issues.push(`The end date in “${datePart}” is before the start date.`);
  }
  if (year && start.slice(0, 4) !== year) issues.push(`The date should be in ${year}, like the year folder.`);

  const rest = name.slice(datePart.length);
  if (!rest) {
    issues.push("Add the activity name after the date, e.g. “20260315 Troodos Hike”.");
    return issues;
  }
  if (!rest.startsWith(" ") || rest.trimStart().startsWith("-")) {
    issues.push("Put a single space after the date, not “-”.");
  }
  const title = rest.replace(/^[\s-]+/, "");
  if (/\s{2,}/.test(rest.trimStart()) || rest.startsWith("  ")) issues.push("Use single spaces between words.");
  const words = title.split(/[\s-]+/).filter(Boolean);
  const badWords = words.filter((w, i) => !/^[\p{Lu}\d][\p{L}\d]*$/u.test(w) && !(i > 0 && connectors.has(w)));
  if (badWords.length) {
    issues.push(
      `Write words in CamelCase (capital first letter, letters and digits only; “the”, “in”, “at”, “of”, “n” and “&” are allowed after the first word): ${
        badWords.map((w) => `“${w}”`).join(", ")
      }.`,
    );
  }
  return issues;
}
