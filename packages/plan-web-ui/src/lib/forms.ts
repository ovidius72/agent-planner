export function requiredString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Response(`Missing field: ${key}`, { status: 400 });
  }
  return value.trim();
}

export function optionalString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function optionalNumber(formData: FormData, key: string): number {
  const value = formData.get(key);
  if (typeof value !== "string") return 0;
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function stringList(formData: FormData, key: string): string[] {
  return optionalString(formData, key)
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
}

export interface SubmittedMacroTask {
  id?: string;
  title: string;
  description: string;
  status: string;
}

/** Parse form-owned fields only; planner persistence assigns identifiers and timestamps. */
export function submittedMacroTasks(formData: FormData): SubmittedMacroTask[] {
  const raw = optionalString(formData, "macroTasks");
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Response("Macro tasks must be valid form data.", { status: 400 });
  }
  if (!Array.isArray(parsed)) throw new Response("Macro tasks must be a list.", { status: 400 });
  return parsed.map((value, index) => {
    if (!value || typeof value !== "object") throw new Response(`Macro task ${index + 1} is invalid.`, { status: 400 });
    const record = value as Record<string, unknown>;
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const status = typeof record.status === "string" ? record.status.trim() : "";
    if (!title) throw new Response(`Macro task ${index + 1} requires a title.`, { status: 400 });
    if (!status) throw new Response(`Macro task ${index + 1} requires a status.`, { status: 400 });
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : undefined;
    return {
      ...(id ? { id } : {}),
      title,
      description: typeof record.description === "string" ? record.description.trim() : "",
      status,
    };
  });
}

export function requiredParam(params: Record<string, string | undefined>, key: string): string {
  const value = params[key];
  if (!value) {
    throw new Response(`Missing route param: ${key}`, { status: 400 });
  }
  return value;
}
