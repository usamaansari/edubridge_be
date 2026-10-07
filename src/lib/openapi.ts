import { z } from "zod";

import { env } from "../config/env.js";
import { routeRegistry, type RouteDoc } from "./api-module.js";

type JsonSchema = Record<string, unknown> & {
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

function toJsonSchema(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as JsonSchema;
  delete json.$schema;
  return json;
}

function toParameters(schema: z.ZodType | undefined, location: "query" | "path") {
  if (!schema) return [];
  const json = toJsonSchema(schema);
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {}).map(([name, propertySchema]) => ({
    name,
    in: location,
    required: location === "path" || required.has(name),
    schema: propertySchema,
  }));
}

function implicitPathParameters(route: RouteDoc) {
  const declared = new Set(
    Object.keys(route.params ? (toJsonSchema(route.params).properties ?? {}) : {}),
  );
  return [...route.path.matchAll(/:(\w+)/g)]
    .map((m) => m[1] as string)
    .filter((name) => !declared.has(name))
    .map((name) => ({ name, in: "path", required: true, schema: { type: "string" } }));
}

function describeAccess(route: RouteDoc): string {
  if (!route.auth) return "Public endpoint.";
  if (!route.roles) return "Requires authentication.";
  return `Roles: ${route.roles.join(", ")}.`;
}

const errorResponse = { $ref: "#/components/responses/Error" };

export function buildOpenApiSpec() {
  const paths: Record<string, Record<string, unknown>> = {};
  const tags = new Map<string, string>();

  for (const route of routeRegistry) {
    tags.set(route.tag, route.tag);
    const openApiPath = route.path.replace(/:(\w+)/g, "{$1}");
    const operation: Record<string, unknown> = {
      tags: [route.tag],
      summary: route.summary,
      description: [route.description, describeAccess(route)].filter(Boolean).join("\n\n"),
      parameters: [
        ...toParameters(route.params, "path"),
        ...implicitPathParameters(route),
        ...toParameters(route.query, "query"),
      ],
      responses: {
        [route.status]: { description: "Success" },
        400: errorResponse,
        ...(route.auth ? { 401: errorResponse, 403: errorResponse } : {}),
      },
    };
    if (route.auth) operation.security = [{ bearerAuth: [] }];
    if (route.body || route.multipart) {
      const bodySchema = route.body ? toJsonSchema(route.body) : { type: "object" };
      if (route.multipart) {
        bodySchema.properties = {
          ...(bodySchema.properties ?? {}),
          file: { type: "string", format: "binary" },
        };
      }
      operation.requestBody = {
        required: true,
        content: { [route.multipart ? "multipart/form-data" : "application/json"]: { schema: bodySchema } },
      };
    }
    (paths[openApiPath] ??= {})[route.method] = operation;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "EduBridge Academy API",
      version: "1.0.0",
      description:
        "Backend for EduBridge Academy (JEE/NEET coaching for Classes 9–12). Authenticate with `POST /auth/login`, then click **Authorize** and paste the `accessToken`. Errors are returned as `{ message, details? }`.",
    },
    servers: [{ url: env.swaggerServerUrl }],
    tags: [...tags.keys()].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      responses: {
        Error: {
          description: "Error",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: { type: "string" },
                  details: {
                    type: "object",
                    additionalProperties: { type: "array", items: { type: "string" } },
                  },
                },
                required: ["message"],
              },
            },
          },
        },
      },
    },
  };
}
