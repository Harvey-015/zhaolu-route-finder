import { ProviderError } from "./errors.ts";
import type { ProviderPhysicalCallBudget } from "./ports.ts";

export function createProviderPhysicalCallBudget(
  maximum: number,
): ProviderPhysicalCallBudget {
  if (!Number.isInteger(maximum) || maximum < 1) {
    throw new RangeError("PROVIDER_PHYSICAL_CALL_BUDGET_INVALID");
  }
  let remaining = maximum;
  return Object.freeze({
    consume(providerId: string): void {
      if (remaining <= 0) {
        throw new ProviderError({
          providerId,
          code: "QUOTA_EXCEEDED",
          message: "PROVIDER_PHYSICAL_CALL_BUDGET_EXCEEDED",
          retryable: false,
        });
      }
      remaining -= 1;
    },
    remaining(): number {
      return remaining;
    },
  });
}
