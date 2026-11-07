import { html, nothing, type PropertyValues } from "lit";
import {
  validEntitySelection,
  type EntitySelectorConfig,
  type EntitySelectorSource,
} from "../../entities/entity-selector";
import { QapPicker } from "./picker";

/** The filter editor supplies its existing shared registry/search source. */
export class QapEntitySelector extends QapPicker {
  static properties = {
    selector: { attribute: false },
    source: { attribute: false },
    entityLabel: {},
  };
  declare selector: { entity: EntitySelectorConfig };
  declare source: EntitySelectorSource | undefined;
  declare entityLabel: string;
  constructor() {
    super();
    this.selector = { entity: {} };
    this.entityLabel = "Entity";
    this.noMatchLabel = "No matching entities";
    this.addLabel = "Add entity";
    this.searchLabel = "Search entities";
  }
  protected override get multiple() {
    return Boolean(this.selector.entity.multiple);
  }
  protected override searchOptions(query: string) {
    return this.source?.search(query, this.selector.entity, this.current) ?? [];
  }
  protected override getOption(value: string) {
    return this.source?.get(value);
  }
  protected override get fieldIcon() {
    return this.current ? this.getOption(this.current)?.icon || "mdi:shape" : undefined;
  }
  protected override get selectionName() {
    const selected = this.getOption(this.current);
    return selected ? `${selected.label} (${this.current})` : this.current;
  }
  protected override accepts(value: string, current = this.current) {
    return validEntitySelection(value, this.selector.entity, current, this.source?.get(value));
  }
  protected override willUpdate(changed: PropertyValues) {
    this.optionLabel = this.entityLabel;
    if (changed.has("selector") || changed.has("value")) {
      const previous = changed.get("selector") as { entity: EntitySelectorConfig } | undefined;
      const value = this.value;
      const values = this.values;
      let normalized;
      if (this.multiple) normalized = Array.isArray(value) && value.every(Boolean) ? value : values;
      else normalized = Array.isArray(value) ? values.find(Boolean) : value;
      if (normalized !== value) {
        this.value = normalized;
        // Initialization and externally supplied empty values are not user edits.
        if (previous && Boolean(previous.entity.multiple) !== this.multiple && value != null) {
          this.dispatchEvent(
            new CustomEvent("value-changed", {
              detail: { value: this.value },
              bubbles: true,
              composed: true,
            }),
          );
        }
      }
    }
    super.willUpdate(changed);
  }
  protected override get values() {
    return super.values.filter(Boolean);
  }
  protected updateRow(index: number, event: CustomEvent<{ value?: string }>) {
    event.stopPropagation();
    if (this.disabled) return;
    const next = event.detail.value;
    const values = this.values;
    if (index < values.length && next === values[index]) return;
    if (next && !this.accepts(next, values[index] ?? "")) {
      if (event.currentTarget instanceof QapEntitySelector)
        event.currentTarget.value = values[index] ?? "";
      return;
    }
    let updated = values;
    if (index === values.length) {
      if (next && !values.includes(next)) updated = [...values, next];
    } else if (!next || values.some((value, at) => at !== index && value === next)) {
      updated = values.filter((_, at) => at !== index);
    } else updated = values.map((value, at) => (at === index ? next : value));
    if (updated === values) return;
    this.value = updated;
    this.dispatchEvent(
      new CustomEvent("value-changed", {
        detail: { value: updated },
        bubbles: true,
        composed: true,
      }),
    );
    // The owning form may reject the commit (for example at its value limit).
    // Reset the edited child explicitly: Lit's cached property binding still
    // holds the previous value when the owner restores the same array.
    const child = event.currentTarget;
    if (child instanceof QapEntitySelector) child.value = this.values[index] ?? "";
    if (index === values.length || !next) {
      const focusRow = () => {
        void this.updateComplete.then(() => {
          if (!this.isConnected || this.disabled) return;
          const rows = this.shadowRoot?.querySelectorAll<QapEntitySelector>("qap-entity-selector");
          rows?.[
            index === values.length ? rows.length - 1 : Math.min(index, rows.length - 1)
          ]?.focus({ preventScroll: true });
        });
      };
      // The parent form stays inert until the child's picker finishes closing.
      if (child instanceof QapEntitySelector && child.popup?.open)
        child.popup.addEventListener("closed", focusRow, { once: true });
      else focusRow();
    }
  }
  protected override renderMultiple() {
    const values = this.values;
    const config = this.selector.entity;
    return html`${this.label ? html`<div class="multiple-label">${this.label}</div>` : nothing}
    ${[...values, ""].map(
      (value, index) =>
        html`<qap-entity-selector
          class=${index === values.length ? "add-control" : ""}
          .value=${value}
          .label=${""}
          .source=${this.source}
          .revision=${this.revision}
          .addButton=${index === values.length && values.length > 0}
          .addLabel=${this.addLabel}
          .searchLabel=${this.searchLabel}
          .selector=${{
            entity: {
              ...config,
              multiple: false,
              exclude_entities:
                index === values.length
                  ? [...(config.exclude_entities ?? []), ...values]
                  : config.exclude_entities,
            },
          }}
          .required=${this.required && !values.length}
          .disabled=${this.disabled}
          .clearLabel=${this.clearLabel}
          .noMatchLabel=${this.noMatchLabel}
          .helper=${index === values.length ? this.helper : ""}
          aria-label=${this.ariaLabel || this.label || this.entityLabel}
          aria-invalid=${this.ariaInvalid ?? nothing}
          .ariaDescription=${this.description === nothing ? null : this.description}
          @value-changed=${(event: CustomEvent<{ value?: string }>) => this.updateRow(index, event)}
          @change=${(event: Event) => event.stopPropagation()}
        ></qap-entity-selector>`,
    )}`;
  }
}
