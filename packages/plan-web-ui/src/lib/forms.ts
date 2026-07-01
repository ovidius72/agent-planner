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

export function stringList(formData: FormData, key: string): string[] {
  return optionalString(formData, key)
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function requiredParam(params: Record<string, string | undefined>, key: string): string {
  const value = params[key];
  if (!value) {
    throw new Response(`Missing route param: ${key}`, { status: 400 });
  }
  return value;
}
