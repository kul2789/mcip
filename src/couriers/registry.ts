import { unsupportedCourier } from "../errors";
import type { CourierPort } from "./port";

export class CourierRegistry {
  private readonly adapters = new Map<string, CourierPort>();

  constructor(adapters: CourierPort[]) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.partner, adapter);
    }
  }

  get(partner: string): CourierPort {
    const key = partner.trim().toLowerCase();
    const adapter = this.adapters.get(key);
    if (!adapter) throw unsupportedCourier(partner, this.supported());
    return adapter;
  }

  supported(): string[] {
    return [...this.adapters.keys()];
  }

  has(partner: string): boolean {
    return this.adapters.has(partner.trim().toLowerCase());
  }
}
