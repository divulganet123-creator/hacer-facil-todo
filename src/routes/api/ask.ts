import { createFileRoute } from "@tanstack/react-router";

const OPENAI_URL = "https://api.openai.com/v1/responses";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/ask")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["OPENAI_API_KEY"];
        if (!apiKey) {
          // 412 (not 5xx): missing config is an expected state, not a server crash.
          return json(412, {
            error: "server_not_configured",
            message: "OPENAI_API_KEY não configurada.",
          });
        }

        let prompt: unknown;
        try {
          prompt = (await request.json())?.prompt;
        } catch {
          prompt = undefined;
        }
        if (typeof prompt !== "string" || !prompt.trim()) {
          return json(400, { error: "invalid_prompt", message: "Prompt inválido." });
        }

        let resp: Response;
        try {
          resp = await fetch(OPENAI_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: process.env["OPENAI_MODEL"] || "gpt-6-sol",
              input: prompt,
              store: false,
            }),
            signal: request.signal,
          });
        } catch (e) {
          return json(500, {
            error: "openai_error",
            message: e instanceof Error ? e.message : "Erro interno.",
          });
        }

        const data = (await resp.json().catch(() => null)) as {
          error?: { message?: string };
          output_text?: string;
          output?: Array<{
            content?: Array<{ type?: string; text?: string }>;
          }>;
        } | null;

        if (!resp.ok) {
          const code =
            resp.status === 401 || resp.status === 403
              ? "openai_auth_error"
              : resp.status === 429
                ? "rate_limited"
                : "openai_error";
          return json(resp.status, {
            error: code,
            message: data?.error?.message || "Erro na OpenAI.",
          });
        }

        const text =
          data?.output_text ||
          (data?.output || [])
            .flatMap((x) => x.content || [])
            .filter((x) => x.type === "output_text")
            .map((x) => x.text || "")
            .join("");

        return json(200, { text });
      },
    },
  },
});
