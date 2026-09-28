import type { SupabaseClient } from "@supabase/supabase-js";

export type FolderStatus = "upcoming" | "pending" | "done";

export interface TransferJob {
  id: string;
  drive_folder_id: string;
  folder_name: string;
  album_title: string;
  album_id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  operator_email: string;
  items_total: number;
  items_done: number;
  items_skipped: number;
  items_failed: number;
  started_at: string;
  finished_at: string | null;
}

export interface Folder {
  id: string;
  name: string;
  url: string;
  createdTime: string;
  mediaCount: number;
  status: FolderStatus;
  album: { id: string; title: string; url: string | null; lastTransferAt: string | null } | null;
  runningJob: TransferJob | null;
}

export interface StudioStatus {
  connected: boolean;
  accountEmail: string | null;
  expectedEmail: string;
  rootFolderUrl: string;
  logSheetUrl: string | null;
  lastJob: TransferJob | null;
}

export interface StepResult {
  job: TransferJob;
  current?: { name: string; bytesSent: number; size: number; status: string; error?: string };
  busy?: boolean;
}

async function call<T>(supabase: SupabaseClient, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("studio-api", { body });
  if (error) {
    console.error("studio-api call failed", body.action, error);
    // Only FunctionsHttpError carries a Response; FunctionsFetchError carries the network error.
    const context: unknown = (error as { context?: unknown }).context;
    if (error.name === "FunctionsHttpError" && context instanceof Response) {
      let message: string | null = null;
      try {
        message = (await context.json())?.error ?? null;
      } catch { /* body was not JSON */ }
      throw new Error(message ?? `The AZO Studio server returned HTTP ${context.status}.`);
    }
    if (error.name === "FunctionsFetchError") {
      throw new Error("Could not reach the AZO Studio server (Edge Function studio-api). Check that it is deployed to this Supabase project.");
    }
    if (error.name === "FunctionsRelayError") {
      throw new Error("Supabase could not run the studio-api function. Try again.");
    }
    throw new Error(error.message);
  }
  return data as T;
}

export const studioApi = {
  status: (s: SupabaseClient) => call<StudioStatus>(s, { action: "status" }),
  connectUrl: (s: SupabaseClient) => call<{ url: string }>(s, { action: "connect-url" }),
  folders: (s: SupabaseClient) => call<{ folders: Folder[] }>(s, { action: "folders" }),
  rename: (s: SupabaseClient, folderId: string, name: string) => call<{ name: string }>(s, { action: "rename", folderId, name }),
  startTransfer: (s: SupabaseClient, folderId: string, title: string) =>
    call<{ job: TransferJob }>(s, { action: "transfer-start", folderId, title }),
  step: (s: SupabaseClient, jobId: string) => call<StepResult>(s, { action: "transfer-step", jobId }),
  cancel: (s: SupabaseClient, jobId: string) => call<{ job: TransferJob }>(s, { action: "transfer-cancel", jobId }),
};
