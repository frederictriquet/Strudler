<script lang="ts">
  // [SPEC-17.26] Transient toasts for warn/error notices, top-right, so they are
  // seen without scrolling to the journal at the bottom of the page.
  import { toasts, dismissToast } from '@stores/logStore';

  const items = toasts;
  const icon = (level: string): string => (level === 'error' ? '✕' : '⚠');
</script>

<div class="toasts" aria-live="assertive">
  {#each $items as t (t.id)}
    <div class="toast {t.level}" role="alert">
      <span class="ico">{icon(t.level)}</span>
      <span class="txt">{t.text}</span>
      <button class="close" onclick={() => dismissToast(t.id)} aria-label="Fermer">✕</button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: min(440px, 92vw);
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--panel);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
    font-size: 0.85rem;
    animation: toast-in 0.15s ease-out;
  }
  .toast.error {
    border-color: var(--danger);
  }
  .toast.warn {
    border-color: #f0b429;
  }
  .ico {
    flex: none;
    font-weight: 700;
  }
  .toast.error .ico {
    color: var(--danger);
  }
  .toast.warn .ico {
    color: #f0b429;
  }
  .txt {
    flex: 1;
    color: var(--text);
    line-height: 1.35;
  }
  .close {
    flex: none;
    padding: 0 0.3rem;
    color: var(--muted);
    font-size: 0.75rem;
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
