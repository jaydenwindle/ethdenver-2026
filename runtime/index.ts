import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { CORSPlugin } from "@orpc/server/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

import { API_PREFIX } from "./src/contract";
import { router } from "./src/router";

const apiHandler = new OpenAPIHandler(router, {
  plugins: [
    new CORSPlugin(),
    new OpenAPIReferencePlugin({
      docsPath: `${API_PREFIX}/docs`,
      specPath: `${API_PREFIX}/openapi.json`,
      schemaConverters: [new ZodToJsonSchemaConverter()],
      specGenerateOptions: {
        info: {
          title: "Runtime oRPC API",
          version: "1.0.0",
        },
      },
    }),
  ],
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

const server = Bun.serve({
  port: 8000,
  async fetch(request) {
    const result = await apiHandler.handle(request, { context: { request } });

    if (result.matched) {
      return result.response;
    }

    return new Response("Not Found", { status: 404 });
  },
});

const baseUrl = `http://localhost:${server.port}`;

console.log(`oRPC server running at ${baseUrl}`);
console.log(`OpenAPI docs: ${baseUrl}${API_PREFIX}/docs`);
console.log(`OpenAPI spec: ${baseUrl}${API_PREFIX}/openapi.json`);
