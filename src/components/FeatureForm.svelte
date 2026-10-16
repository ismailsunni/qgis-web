<script lang="ts">
  import { readForm, displayValue, parseInput, validate, defaultValues, type FieldForm } from "../lib/forms";
  import { setAttributes, editSession } from "../lib/editing";
  import { ui } from "../lib/state.svelte";
  import { t } from "../lib/i18n";

  let { layerId, fid, attributes }: { layerId: string; fid: number; attributes: [string, unknown][] } = $props();

  const forms = $derived((ui.version, readForm(layerId)));
  const editable = $derived(ui.editing === layerId && !!editSession());
  let errors = $state<Record<string, string>>({});
  let values = $derived(Object.fromEntries(attributes));

  function change(name: string, form: FieldForm | undefined, raw: string | boolean) {
    const old = values[name];
    const value = typeof raw === "boolean" ? (raw ? (form?.config.CheckedState ?? 1) : (form?.config.UncheckedState ?? 0)) : parseInput(form, raw, old);
    const check = validate(layerId, fid, form, value);
    if (check.error) {
      errors = { ...errors, [name]: check.error };
      return;
    }
    errors = { ...errors, [name]: check.warning ?? "" };
    setAttributes(fid, { [name]: value, ...defaultValues(layerId, fid, true) }, t("edit {name}", { name }));
    const a = attributes.find(([k]) => k === name);
    if (a) a[1] = value;
  }

  const dateValue = (v: unknown, withTime: boolean) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, withTime ? 16 : 10) : "");
</script>

<table class="attrs">
  <tbody>
    {#each attributes as [name, v] (name)}
      {@const form = forms.get(name)}
      {#if !form?.hidden}
        {@const canEdit = editable && name !== editSession()?.info.fid && !form?.readOnly}
        <tr>
          <th title={form?.alias ? name : undefined}>{form?.alias || name}{#if canEdit && form?.notNull}<span class="req">*</span>{/if}</th>
          {#if canEdit}
            <td>
              {#if form?.widget === "ValueMap"}
                <select value={v === null ? "" : String(v)} onchange={(e) => change(name, form, e.currentTarget.value)}>
                  {#if !form.notNull}<option value="">NULL</option>{/if}
                  {#each form.options as [label, val]}<option value={val}>{label}</option>{/each}
                </select>
              {:else if form?.widget === "CheckBox"}
                <input type="checkbox" checked={displayValue(form, v) === "✓"} onchange={(e) => change(name, form, e.currentTarget.checked)} />
              {:else if form?.widget === "Range"}
                <input type="number" min={form.config.Min as number} max={form.config.Max as number} step={(form.config.Step as number) ?? "any"} value={v ?? ""} onchange={(e) => change(name, form, e.currentTarget.value)} />
              {:else if form?.widget === "DateTime"}
                {@const withTime = /h|H/.test(String(form.config.field_format ?? ""))}
                <input type={withTime ? "datetime-local" : "date"} value={dateValue(v, withTime)} onchange={(e) => change(name, form, e.currentTarget.value)} />
              {:else if form?.widget === "TextEdit" && form.config.IsMultiline}
                <textarea rows="3" value={v === null ? "" : String(v)} onchange={(e) => change(name, form, e.currentTarget.value)}></textarea>
              {:else}
                <input value={v === null ? "" : String(v)} placeholder="NULL" onchange={(e) => change(name, form, e.currentTarget.value)} />
              {/if}
              {#if errors[name]}<div class="field-error">{errors[name]}</div>{/if}
            </td>
          {:else}
            <td>{displayValue(form, v)}</td>
          {/if}
        </tr>
      {/if}
    {/each}
  </tbody>
</table>
