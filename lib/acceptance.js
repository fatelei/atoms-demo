export const MAX_CHECKS = 6;
export const MAX_REGRESSION_CHECKS = 4;
export const MAX_STEPS = 10;

const actions = new Set(["fill", "click", "assertText", "assertAbsent"]);

function parseStep(step) {
  if (
    !actions.has(step?.action) ||
    typeof step.selector !== "string" ||
    !step.selector.trim() ||
    step.selector.length > 180
  ) return null;

  const result = { action: step.action, selector: step.selector.trim() };
  if (step.action === "fill" || step.action === "assertText") {
    if (typeof step.value !== "string" || step.value.length > 180) return null;
    result.value = step.value;
  }
  return result;
}

export function readChecks(input, scope, limit = MAX_CHECKS) {
  if (!Array.isArray(input)) return [];

  const checks = [];
  for (const item of input.slice(0, MAX_CHECKS)) {
    if (
      typeof item?.title !== "string" ||
      !item.title.trim() ||
      item.title.length > 80 ||
      !Array.isArray(item.steps) ||
      item.steps.length > MAX_STEPS
    ) continue;

    const steps = item.steps.map(parseStep);
    if (steps.includes(null) || !steps.some((step) => step.action.startsWith("assert"))) continue;
    checks.push({ title: item.title.trim(), steps, scope });
    if (checks.length === limit) break;
  }
  return checks;
}
