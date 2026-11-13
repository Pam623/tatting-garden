// What the home page offers to pick up again. Pure, so it can be tested without a browser.
import { clampProgress, hasStarted, progressPlace } from './pattern.js';

// Patterns started and not finished, most recently worked first.
// read(id) gives the stored progress for a pattern as saved, or null.
export function resumeList(patterns, read) {
  return patterns
    .map((pattern) => {
      const saved = read(pattern.id);
      const progress = clampProgress(saved, pattern.elements.length);
      if (!hasStarted(progress) || progress.finished) return null;
      return {
        pattern,
        index: progress.index,
        pass: progress.pass,
        place: progressPlace(progress),
        total: pattern.elements.length,
        at: Number.isFinite(saved?.at) ? saved.at : 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.at - a.at);
}

// Wished-for library cards, in the order they were wished for; ids no longer in the library are left out.
export function wishedCards(cards, wishes) {
  return wishes.map((id) => cards.find((card) => card.id === id)).filter(Boolean);
}
