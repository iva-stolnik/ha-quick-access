import { FILTER_VALUE_LIMIT } from "./filter-definitions.js";

/** Reuse the owned select and selector fields, retaining the editor's validation. */
export function createFilterValueControl({
  title,
  value,
  multiple = false,
  getData,
  onChange,
  ui,
  forms,
  l10n,
}) {
  const { node, replaceLocalizedChildren } = ui;
  const t = l10n.message;
  const element = node("div", "qap-filter-value");
  const status = node("div", "qap-field-tip");
  status.setAttribute("role", "status");
  let data = getData();
  let field;
  let custom;
  function options() {
    const options = data.options.map((option) => [
      option.value,
      option.label === option.value ? option.label : `${option.label} (${option.value})`,
    ]);
    const values = multiple ? value : [value];
    for (const saved of new Set(values)) {
      if (saved !== "" && !data.options.some((option) => option.value === saved)) {
        options.push([
          saved,
          data.markMissing && data.status !== "loading"
            ? t("filters.missing_value", { value: String(saved) })
            : String(saved),
        ]);
      }
    }
    return options;
  }
  const selector = () => ({
    select: {
      options: options().map(([value, label]) => ({ value, label })),
      mode: "dropdown",
      multiple,
      custom_value: data.allowCustom,
    },
  });
  function syncStatus() {
    status.hidden =
      data.status === "loading" ||
      (data.status !== "load_failed" &&
        Boolean(data.options.length) &&
        !(multiple && value.length >= FILTER_VALUE_LIMIT));
    let message = "";
    if (!status.hidden) {
      if (data.status === "load_failed") message = t("filters.values_unavailable");
      else if (multiple && value.length >= FILTER_VALUE_LIMIT) message = t("filters.values_limit");
      else message = t("filters.values_empty");
    }
    l10n.text(status, message);
  }
  function render() {
    custom = Boolean(data.allowCustom);
    if (multiple || custom) {
      field = forms.selectorField(
        title,
        selector(),
        value,
        multiple ? t("filters.values_hint") : undefined,
      );
    } else field = forms.select(title, options(), value);
    field.onChange(() => {
      const next = field.value;
      if (
        (multiple &&
          (!Array.isArray(next) ||
            next.length > FILTER_VALUE_LIMIT ||
            next.some((item) => typeof item !== "string" || item.length > 256))) ||
        (!multiple && (typeof next !== "string" || next.length > 256))
      ) {
        field.value = value;
        return;
      }
      value = multiple ? [...new Set(next)] : next;
      field.value = value;
      onChange(value);
      syncStatus();
    });
    replaceLocalizedChildren(element, field.element, status);
    syncStatus();
  }
  render();
  return {
    element,
    refresh() {
      const next = getData();
      if (next === data) return;
      data = next;
      if (!multiple && custom !== Boolean(data.allowCustom)) {
        render();
      } else if (multiple || custom) field.setSelector(selector());
      else field.setOptions(options());
      syncStatus();
    },
  };
}
