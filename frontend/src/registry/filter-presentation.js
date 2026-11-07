/** Presentation for condition row labels and icons. */
export function conditionSummary(condition, t) {
  const field = `${t(`filters.field_${condition.field}`)}${condition.field === "attribute" ? ` [${JSON.stringify(condition.attribute)}]` : ""}`;
  const operator = t(`filters.op_${condition.operator}`);
  const value = condition.operator === "exists" ? "" : JSON.stringify(condition.value);
  return { field, operator, value, text: [field, operator, value].filter(Boolean).join(" ") };
}

export function conditionIcon(condition) {
  const icons = {
    state: "mdi:toggle-switch-outline",
    attribute: "mdi:code-braces",
    id: "mdi:identifier",
    name: "mdi:rename-outline",
    domain: "mdi:shape-outline",
    area: "mdi:floor-plan",
    label: "mdi:tag-outline",
    manufacturer: "mdi:factory",
    model: "mdi:devices",
    platform: "mdi:puzzle-outline",
    device_class: "mdi:shape",
    hidden_by: "mdi:eye-off-outline",
    entity_category: "mdi:folder-outline",
    smart: "mdi:filter-variant",
    model_id: "mdi:barcode",
    serial_number: "mdi:barcode-scan",
    sw_version: "mdi:application-cog-outline",
    hw_version: "mdi:chip",
    entry_type: "mdi:devices",
  };
  return icons[condition.field] || "mdi:filter-variant";
}
