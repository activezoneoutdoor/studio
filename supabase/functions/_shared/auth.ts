import { adminClient } from "./db.ts";
import { allowedDomain } from "./config.ts";
import { HttpError } from "./http.ts";
import { isOperatorEmail } from "./rules.ts";

export interface Operator {
  id: string;
  email: string;
}

/** Verifies the caller's Supabase session and that it belongs to the Workspace domain. */
export async function requireOperator(req: Request): Promise<Operator> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in required.");
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Your session has expired. Sign in again.");
  const email = data.user.email?.toLowerCase() ?? "";
  if (!isOperatorEmail(email)) throw new HttpError(403, `AZO Studio is limited to @${allowedDomain} accounts.`);
  return { id: data.user.id, email };
}
