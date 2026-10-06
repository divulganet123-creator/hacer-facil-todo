import { createFileRoute } from "@tanstack/react-router";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

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
        const apiKey = process.env["OPENROUTER_API_KEY"];
        if (!apiKey) {
          return json(412, {
            error: "server_not_configured",
            message: "OPENROUTER_API_KEY não configurada.",
          });
        }
        const model = process.env["OPENROUTER_MODEL"] || "openai/gpt-4o-mini";

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
              messages: [{ role: "user", content: prompt }],
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
        let apiError: { status: number; message: string } | null = null;

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
                  error?: { code?: string; message?: string };
                  choices?: Array<{ delta?: { content?: string } }>;
                };
                if (evt.error) {
                  const code = evt.error.code || "";
                  const message = evt.error.message || "Erro no serviço de IA.";
                  apiError = {
                    status: String(code) === "402" || /insufficient|credit|quota/i.test(String(code)) ? 402 : 502,
                    message,
                  };
                } else if (evt.choices?.[0]?.delta?.content) {
                  text += evt.choices[0].delta.content;
                }
              } catch {
                // ignore non-JSON keep-alive lines
              }
            }
          }
        }

        if (apiError) {
          return json(apiError.status, {
            error: "ai_error",
            message: apiError.message,
          });
        }

        return json(200, { text });
      },
    },
  },
});
