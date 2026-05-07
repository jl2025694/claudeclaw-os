let tooltipEl: HTMLDivElement | null = null;
let activeTarget: HTMLElement | null = null;

function getTooltip(): HTMLDivElement {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'agent-id-tooltip-layer';
  tooltipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function placeTooltip(target: HTMLElement): void {
  const text = target.dataset.agentIdTooltip;
  if (!text) return;

  const el = getTooltip();
  el.textContent = text;
  el.classList.add('show');

  const targetRect = target.getBoundingClientRect();
  const tooltipRect = el.getBoundingClientRect();
  const gap = 10;
  const x = clamp(
    targetRect.left + targetRect.width / 2 - tooltipRect.width / 2,
    8,
    window.innerWidth - tooltipRect.width - 8,
  );
  const y = targetRect.top >= tooltipRect.height + gap + 8
    ? targetRect.top - tooltipRect.height - gap
    : targetRect.bottom + gap;

  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
}

function closestTooltipTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  return node.closest<HTMLElement>('[data-agent-id-tooltip]');
}

function show(target: HTMLElement): void {
  activeTarget = target;
  placeTooltip(target);
}

function hide(target?: HTMLElement | null): void {
  if (target && activeTarget !== target) return;
  activeTarget = null;
  if (tooltipEl) tooltipEl.classList.remove('show');
}

document.addEventListener('pointerover', (event) => {
  const target = closestTooltipTarget(event.target);
  if (target) show(target);
});

document.addEventListener('pointerout', (event) => {
  const target = closestTooltipTarget(event.target);
  if (!target) return;
  const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
  if (next && target.contains(next)) return;
  hide(target);
});

document.addEventListener('pointermove', () => {
  if (activeTarget) placeTooltip(activeTarget);
});

document.addEventListener('focusin', (event) => {
  const target = closestTooltipTarget(event.target);
  if (target) show(target);
});

document.addEventListener('focusout', (event) => {
  hide(closestTooltipTarget(event.target));
});

window.addEventListener('scroll', () => {
  if (activeTarget) placeTooltip(activeTarget);
}, true);

window.addEventListener('resize', () => {
  if (activeTarget) placeTooltip(activeTarget);
});
