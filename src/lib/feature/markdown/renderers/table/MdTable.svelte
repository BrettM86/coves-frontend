<script lang="ts">
  let { children } = $props()
</script>

<div class="overflow-auto w-full table-container">
  <table class="w-full table-fixed rounded-xl min-w-md">
    {@render children?.()}
  </table>
</div>

<style>
  @reference "../../../../../app.css";

  .table-container {
    border: 1px solid var(--color-slate-200);
    background-color: white;
    border-radius: var(--radius-2xl);

    @variant dark {
      background-color: var(--color-zinc-950);
      border: 1px solid var(--color-zinc-800);
    }
  }

  .table-container table {
    table-layout: fixed !important;

    :global(thead tr th) {
      padding: calc(var(--spacing) * 1.5) calc(var(--spacing) * 3);
      border-bottom: 1px solid var(--color-slate-200);
      font-weight: var(--font-weight-medium);
      font-size: var(--text-base);
      background-color: var(--color-slate-25);

      @variant dark {
        background-color: var(--color-zinc-900);
        border-bottom: 1px solid var(--color-zinc-800);
      }
    }

    /* Browsers center <th> by default; GFM headers sit over left-aligned
       body cells. Only unaligned columns, so a column's align attribute
       (a presentational hint, which any stylesheet rule would beat) still
       wins when the author asked for center or right. */
    :global(thead tr th:not([align])) {
      text-align: left;
    }
  }

  .table-container table {
    :global(tbody tr td) {
      font-size: var(--text-sm);
      padding: calc(var(--spacing) * 1) calc(var(--spacing) * 3);
    }
  }
</style>
