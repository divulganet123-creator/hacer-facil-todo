import { createFileRoute } from "@tanstack/react-router";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/responses";
const MODEL = "openai/gpt-6-astra";

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
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) {
          return json(500, {
            error: "server_not_configured",
            message: "Servidor de IA não configurado.",
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
          resp = await fetch(GATEWAY_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
              "Lovable-API-Key": apiKey,
              "X-Lovable-AIG-SDK": "fetch",
            },
            body: JSON.stringify({
              model: MODEL,
              input: prompt,
              store: false,
              stream: true,
              reasoning: { effort: "low" },
            }),
            signal: request.signal,
          });
        } catch (e) {
          return json(500, {
            error: "openai_error",
            message: e instanceof Error ? e.message : "Erro interno.",
          });
        }

        if (!resp.ok || !resp.body) {
          const data = (await resp.json().catch(() => null)) as {
            error?: { message?: string };
            message?: string;
          } | null;
          const message =
            data?.error?.message || data?.message || "Erro no serviço de IA.";
          const code =
            resp.status === 401 || resp.status === 403
              ? "openai_auth_error"
              : resp.status === 429
                ? "rate_limited"
                : "openai_error";
          return json(resp.status, { error: code, message });
        }

        // Consume the SSE stream and accumulate the final text.
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let text = "";
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split("\n\n");
            buffer = events.pop() ?? "";
            for (const event of events) {
              for (const line of event.split("\n")) {
                if (!line.startsWith("data:")) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === "[DONE]") continue;
                try {
                  const parsed = JSON.parse(payload) as {
                    type?: string;
                    delta?: string;
                  };
                  if (parsed.type === "response.output_text.delta" && parsed.delta) {
                    text += parsed.delta;
                  }
                } catch {
                  // ignore malformed SSE chunks
                }
              }
            }
          }
        } catch (e) {
          return json(500, {
            error: "openai_error",
            message: e instanceof Error ? e.message : "Erro ao ler a resposta da IA.",
          });
        }

        return json(200, { text });
      },
    },
  },
});
