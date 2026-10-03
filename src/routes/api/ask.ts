import { createFileRoute } from "@tanstack/react-router";

const API_URL = "https://api.openai.com/v1/responses";

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
          return json(412, {
            error: "server_not_configured",
            message: "OPENAI_API_KEY não configurada.",
          });
        }
        const model = process.env["OPENAI_MODEL"] || "gpt-6-sol";

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
          resp = await fetch(API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model,
              input: prompt,
              store: false,
              stream: true,
            }),
            signal: request.signal,
          });
        } catch (e) {
          return json(500, {
            error: "ai_error",
            message: e instanceof Error ? e.message : "Erro interno.",
          });
        }

        if (!resp.ok || !resp.body) {
          const err = (await resp.json().catch(() => null)) as {
            error?: { message?: string };
            message?: string;
          } | null;
          return json(resp.status, {
            error: resp.status === 429 ? "rate_limited" : "ai_error",
            message: err?.error?.message || err?.message || "Erro no serviço de IA.",
          });
        }

        // Stream SSE deltas and accumulate the final text.
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let text = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() || "";
          for (const frame of frames) {
            for (const line of frame.split("\n")) {
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const evt = JSON.parse(payload) as {
                  type?: string;
                  delta?: string;
                };
                if (evt.type === "response.output_text.delta" && evt.delta) {
                  text += evt.delta;
                }
              } catch {
                // ignore non-JSON keep-alive lines
              }
            }
          }
        }

        return json(200, { text });
      },
    },
  },
});
