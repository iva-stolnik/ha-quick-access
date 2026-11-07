/** Display order is independent of the server's stored collection order. */
export function profilesByName<T extends { id: string; name: string }>(
  profiles: readonly T[],
): T[] {
  return [...profiles].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
