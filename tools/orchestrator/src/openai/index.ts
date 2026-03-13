import https from "node:https";
import { URL } from "node:url";
import type { JsonSchema } from "../schemas";

export type StructuredOutputRequest = {
  model: string;
  schemaName: string;
  jsonSchema: JsonSchema;
  systemPrompt: string;
  userPrompt: string;
};

export interface OpenAIResponsesClient {
  createStructuredOutput<T>(request: StructuredOutputRequest): Promise<T>;
}

function extractTextFromResponse(payload: unknown) {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("OpenAI Responses payload is not an object.");
  }

  const record = payload as {
    output_text?: string;
    output?: Array<{
      content?: Array<{
        type?: string;
        text?: string;
        json?: unknown;
      }>;
    }>;
  };

  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text;
  }

  for (const item of record.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string" && content.text.trim()) {
        return content.text;
      }
      if (content.json !== undefined) {
        return JSON.stringify(content.json);
      }
    }
  }

  throw new Error("OpenAI Responses payload did not contain structured output text.");
}

function postJson(url: string, apiKey: string, body: unknown): Promise<unknown> {
  const target = new URL(url);
  const payload = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        method: "POST",
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        let raw = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`OpenAI Responses API failed: ${response.statusCode} ${raw}`));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

export class NodeHttpsResponsesClient implements OpenAIResponsesClient {
  constructor(
    private readonly apiKey: string,
    private readonly endpoint = "https://api.openai.com/v1/responses",
  ) {}

  async createStructuredOutput<T>(request: StructuredOutputRequest): Promise<T> {
    const payload = await postJson(this.endpoint, this.apiKey, {
      model: request.model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: request.systemPrompt }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: request.userPrompt }],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: request.schemaName,
          schema: request.jsonSchema,
          strict: true,
        },
      },
    });

    return JSON.parse(extractTextFromResponse(payload)) as T;
  }
}
