import { MockCourierAdapter } from "./mock";
import { CourierRegistry } from "./registry";
import { UrbaneBoltAdapter } from "./urbanebolt/adapter";

export function createDefaultRegistry(): CourierRegistry {
  return new CourierRegistry([new UrbaneBoltAdapter(), new MockCourierAdapter()]);
}
