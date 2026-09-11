export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "MCIP — Multi-Courier Integration Platform",
    version: "1.0.0",
    description:
      "Courier-agnostic logistics API. Pass courier_partner on write requests. UrbaneBolt and MockCourier are registered adapters.",
  },
  servers: [{ url: "/", description: "Current host" }],
  tags: [
    { name: "Orders" },
    { name: "Bulk" },
    { name: "Couriers" },
    { name: "Health" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Liveness and MySQL ping",
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/v1/couriers": {
      get: {
        tags: ["Couriers"],
        summary: "List supported courier partners",
        responses: { "200": { description: "Partner list" } },
      },
    },
    "/api/v1/orders": {
      post: {
        tags: ["Orders"],
        summary: "Create a shipment",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateOrder" } } },
        },
        responses: {
          "201": { description: "Created" },
          "200": { description: "Idempotent replay" },
          "400": { description: "Validation or unknown courier" },
          "422": { description: "Courier rejected" },
          "502": { description: "Courier unavailable" },
        },
      },
    },
    "/api/v1/orders/bulk": {
      post: {
        tags: ["Bulk"],
        summary: "Queue up to 100 orders (returns batch_id immediately)",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/BulkCreate" } } },
        },
        responses: { "202": { description: "Accepted" }, "400": { description: "Validation error" } },
      },
    },
    "/api/v1/orders/{order_id}/track": {
      get: {
        tags: ["Orders"],
        summary: "Track a shipment and append history",
        parameters: [{ name: "order_id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Tracking" }, "404": { description: "Not found" } },
      },
    },
    "/api/v1/orders/{order_id}/cancel": {
      post: {
        tags: ["Orders"],
        summary: "Cancel a shipment",
        parameters: [{ name: "order_id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  courier_partner: { type: "string" },
                  reason: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Cancelled" },
          "404": { description: "Not found" },
          "409": { description: "Not allowed" },
        },
      },
    },
    "/api/v1/batches/{batch_id}": {
      get: {
        tags: ["Bulk"],
        summary: "Poll bulk job with per-order results",
        parameters: [{ name: "batch_id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Batch" }, "404": { description: "Not found" } },
      },
    },
  },
  components: {
    schemas: {
      Address: {
        type: "object",
        required: ["name", "phone", "address_line1", "city", "state", "pincode"],
        properties: {
          name: { type: "string" },
          phone: { type: "string", example: "9876543210" },
          email: { type: "string" },
          address_line1: { type: "string" },
          address_line2: { type: "string" },
          city: { type: "string" },
          state: { type: "string" },
          pincode: { type: "string", example: "560001" },
          country: { type: "string", example: "IN" },
        },
      },
      CreateOrder: {
        type: "object",
        required: ["order_id", "courier_partner", "payment_mode", "pickup", "delivery", "package"],
        properties: {
          order_id: { type: "string", example: "ORD-1001" },
          courier_partner: { type: "string", enum: ["urbanebolt", "mock"], example: "mock" },
          payment_mode: { type: "string", enum: ["PREPAID", "COD"] },
          cod_amount: { type: "number" },
          service_type: { type: "string", enum: ["SDD", "NDD"] },
          invoice_number: { type: "string" },
          pickup: { $ref: "#/components/schemas/Address" },
          delivery: { $ref: "#/components/schemas/Address" },
          package: {
            type: "object",
            required: ["weight_grams", "length_cm", "width_cm", "height_cm", "items"],
            properties: {
              weight_grams: { type: "number", example: 500 },
              length_cm: { type: "number", example: 10 },
              width_cm: { type: "number", example: 8 },
              height_cm: { type: "number", example: 4 },
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    sku: { type: "string" },
                    name: { type: "string" },
                    qty: { type: "integer" },
                    price: { type: "number" },
                  },
                },
              },
            },
          },
        },
      },
      BulkCreate: {
        type: "object",
        required: ["orders"],
        properties: {
          orders: {
            type: "array",
            minItems: 1,
            maxItems: 100,
            items: { $ref: "#/components/schemas/CreateOrder" },
          },
        },
      },
      ErrorResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          request_id: { type: "string" },
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              details: {},
            },
          },
        },
      },
    },
  },
};
