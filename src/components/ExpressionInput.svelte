<script lang="ts">
  import ExpressionBuilder from "./ExpressionBuilder.svelte";
  import Icon from "./Icon.svelte";

  let { layerId, value, fields, onchange, placeholder = "Field or expression" }: {
    layerId: string;
    value: string;
    fields: string[];
    onchange: (v: string) => void;
    placeholder?: string;
  } = $props();
  let open = $state(false);
  const listId = `fields-${Math.random().toString(36).slice(2)}`;
</script>

<div class="row expr-input">
  <input list={listId} {value} {placeholder} onchange={(e) => onchange(e.currentTarget.value)} />
  <button class="icon" title="Expression builder" aria-label="Expression builder" onclick={() => (open = true)}><Icon name="expr" size={16} /></button>
  <datalist id={listId}>{#each fields as f}<option value={f}></option>{/each}</datalist>
</div>
{#if open}
  <ExpressionBuilder {layerId} initial={value} onapply={(v) => { open = false; onchange(v); }} onclose={() => (open = false)} />
{/if}
