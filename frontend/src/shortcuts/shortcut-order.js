/** Replace category slots without changing the relative order of other categories. */
function replaceCategory(links, group, ordered) {
  let index = 0;
  const result = [];
  const last = links.findLastIndex((link) => link.group === group);
  links.forEach((link, position) => {
    if (link.group !== group) result.push(link);
    else if (index < ordered.length) result.push(ordered[index++]);
    if (position === last) result.push(...ordered.slice(index));
  });
  if (last < 0) result.push(...ordered);
  return result;
}

/** Creates, visibility changes and category transfers append to their section. */
export function upsertShortcut(links, changed) {
  const previous = links.find((link) => link.id === changed.id);
  if (
    previous &&
    previous.group === changed.group &&
    Boolean(previous.hidden) === Boolean(changed.hidden)
  ) {
    return links.map((link) => (link.id === changed.id ? changed : link));
  }
  const remaining = links.filter((link) => link.id !== changed.id);
  const category = remaining.filter((link) => link.group === changed.group);
  const enabled = category.filter((link) => !link.hidden);
  const disabled = category.filter((link) => link.hidden);
  (changed.hidden ? disabled : enabled).push(changed);
  return replaceCategory(remaining, changed.group, [...enabled, ...disabled]);
}

/** Merge only IDs; retain every shortcut object and disabled relative position. */
export function reorderEnabledShortcuts(links, group, ids) {
  const category = links.filter((link) => link.group === group);
  const enabled = category.filter((link) => !link.hidden);
  const byId = new Map(enabled.map((link) => [link.id, link]));
  if (
    ids.length !== enabled.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !byId.has(id))
  ) {
    throw new Error("Shortcut order does not match the category snapshot.");
  }
  if (enabled.every((link, index) => link.id === ids[index])) return links;
  return replaceCategory(links, group, [
    ...ids.map((id) => byId.get(id)),
    ...category.filter((link) => link.hidden),
  ]);
}

/** Append both source subsets in one transfer, retaining all shortcut properties. */
export function transferCategoryShortcuts(links, source, destination) {
  if (source === destination) return links;
  const moved = links
    .filter((link) => link.group === source)
    .map((link) => ({ ...link, group: destination }));
  const remaining = links.filter((link) => link.group !== source);
  const target = remaining.filter((link) => link.group === destination);
  return replaceCategory(remaining, destination, [
    ...target.filter((link) => !link.hidden),
    ...moved.filter((link) => !link.hidden),
    ...target.filter((link) => link.hidden),
    ...moved.filter((link) => link.hidden),
  ]);
}
