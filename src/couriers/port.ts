import type {
  CancelRef,
  CreateOrderInput,
  NormalizedCancel,
  NormalizedShipment,
  NormalizedTracking,
  TrackingRef,
} from "../types";

export interface CourierPort {
  readonly partner: string;
  createShipment(input: CreateOrderInput): Promise<NormalizedShipment>;
  track(ref: TrackingRef): Promise<NormalizedTracking>;
  cancel(ref: CancelRef): Promise<NormalizedCancel>;
}
