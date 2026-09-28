import { config } from "./config.ts";
import { adminClient } from "./db.ts";
import { createSpreadsheetInFolder } from "./drive.ts";
import { getConnection, gfetch, gjson, jsonBody } from "./google.ts";

const api = "https://sheets.googleapis.com/v4/spreadsheets";
const itemsHeader = [
  "Transferred at", "Job ID", "Operator", "Drive folder", "Album", "File name", "Type", "Size (bytes)", "Result", "Google Photos item ID",
];

export interface JobSummary {
  id: string;
  folder_name: string;
  album_title: string;
  operator_email: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  items_total: number;
  items_done: number;
  items_skipped: number;
  items_failed: number;
}

export interface ItemLogRow {
  name: string;
  mime_type: string;
  size: number;
  result: string;
  media_item_id: string | null;
}

/** Returns the transfer log spreadsheet id, creating it in the root Drive folder the first time. */
export async function ensureLogSheet(): Promise<string> {
  const override = Deno.env.get("LOG_SPREADSHEET_ID");
  if (override) return override;
  const connection = await getConnection();
  if (connection?.log_spreadsheet_id) return connection.log_spreadsheet_id;

  const id = await createSpreadsheetInFolder("AZO Studio transfer log", config.driveRootFolderId);
  const meta = await gjson<{ sheets: { properties: { sheetId: number } }[] }>(`${api}/${id}?fields=sheets.properties.sheetId`);
  await gfetch(`${api}/${id}:batchUpdate`, jsonBody({
    requests: [
      { updateSheetProperties: { properties: { sheetId: meta.sheets[0].properties.sheetId, title: "Summary" }, fields: "title" } },
      { addSheet: { properties: { title: "Items", gridProperties: { frozenRowCount: 1 } } } },
    ],
  }));
  await gfetch(`${api}/${id}/values/Items!A1:J1?valueInputOption=RAW`, jsonBody({ values: [itemsHeader] }, "PUT"));
  await adminClient().from("google_connection").update({ log_spreadsheet_id: id }).eq("id", true);
  return id;
}

export function logSheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

export async function appendItemRow(job: JobSummary, item: ItemLogRow): Promise<void> {
  const id = await ensureLogSheet();
  const row = [
    new Date().toISOString(), job.id, job.operator_email, job.folder_name, job.album_title,
    item.name, item.mime_type, item.size, item.result, item.media_item_id ?? "",
  ];
  await gfetch(
    `${api}/${id}/values/Items!A:J:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    jsonBody({ values: [row] }),
  );
}

/** Overwrites the Summary tab with the latest job and item. */
export async function writeSummary(job: JobSummary, lastItem?: { name: string; at: string }): Promise<void> {
  const id = await ensureLogSheet();
  const rows: (string | number)[][] = [
    ["AZO Studio · last transfer", ""],
    ["Last transfer job", job.id],
    ["Status", job.status],
    ["Started at", job.started_at],
    ["Finished at", job.finished_at ?? ""],
    ["Operator", job.operator_email],
    ["Drive folder", job.folder_name],
    ["Google Photos album", job.album_title],
    ["Items in job", job.items_total],
    ["Transferred", job.items_done],
    ["Already in album (removed)", job.items_skipped],
    ["Failed", job.items_failed],
  ];
  if (lastItem) rows.push(["Last item transferred", lastItem.name], ["Last item transferred at", lastItem.at]);
  await gfetch(`${api}/${id}/values/Summary!A1:B20:clear`, { method: "POST" });
  await gfetch(`${api}/${id}/values/Summary!A1:B${rows.length}?valueInputOption=RAW`, jsonBody({ values: rows }, "PUT"));
}
