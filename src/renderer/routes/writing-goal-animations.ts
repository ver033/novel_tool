import { animate, stagger } from "animejs";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function animateWritingGoalDashboard(root: HTMLElement | null): void {
  if (!root || prefersReducedMotion()) {
    return;
  }
  const cards = root.querySelectorAll<HTMLElement>(".writing-goal-animate");
  if (cards.length > 0) {
    animate(cards, {
      opacity: [0, 1],
      y: [10, 0],
      duration: 420,
      delay: stagger(35),
      ease: "outCubic"
    });
  }
}

export function animateWritingGoalCalendar(root: HTMLElement | null): void {
  if (!root || prefersReducedMotion()) {
    return;
  }
  const days = root.querySelectorAll<HTMLElement>(".writing-calendar-day:not(.blank)");
  if (days.length > 0) {
    animate(days, {
      opacity: [0, 1],
      scale: [0.98, 1],
      duration: 320,
      delay: stagger(12),
      ease: "outQuad"
    });
  }
}

export function animateGoalSaved(element: HTMLElement | null): void {
  if (!element || prefersReducedMotion()) {
    return;
  }
  animate(element, {
    scale: [0.98, 1],
    boxShadow: [
      "0 0 0 rgba(37, 99, 235, 0)",
      "0 14px 34px rgba(37, 99, 235, 0.18)",
      "0 0 0 rgba(37, 99, 235, 0)"
    ],
    duration: 760,
    ease: "outCubic"
  });
}
