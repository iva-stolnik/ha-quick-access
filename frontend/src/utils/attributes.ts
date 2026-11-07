import { dump, YAML11_SCHEMA } from "js-yaml";

/** Match HA's read-only YAML wrapper, including its empty-object display. */
export function serializeAttributes(value: unknown): string {
  if (value !== null && typeof value === "object" && Object.keys(value).length === 0) return "";
  return dump(value, { schema: YAML11_SCHEMA, noRefs: true });
}
