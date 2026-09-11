import type { ShipmentStatus } from "../types";

const RULES: Array<{ status: ShipmentStatus; pattern: RegExp }> = [
  { status: "CANCELLED", pattern: /cancel/i },
  { status: "DELIVERED", pattern: /deliver/i },
  { status: "FAILED", pattern: /fail|undeliver|rto|lost|exception/i },
  { status: "PICKED_UP", pattern: /pick/i },
  { status: "IN_TRANSIT", pattern: /transit|hub|ofo|out for|reached|in-scan|out-scan|dispatched/i },
  { status: "CREATED", pattern: /creat|book|manifest|pending|new/i },
];

export function mapCourierStatus(raw: string | undefined | null): ShipmentStatus {
  if (!raw) return "CREATED";
  for (const rule of RULES) {
    if (rule.pattern.test(raw)) return rule.status;
  }
  return "IN_TRANSIT";
}
