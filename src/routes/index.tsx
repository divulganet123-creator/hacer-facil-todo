import { createFileRoute } from "@tanstack/react-router";
import codexHtml from "../assets/codex.html?raw";

// The Codex app is a self-contained HTML page; serve it directly at "/".
export const Route = createFileRoute("/")({
  server: {
    handlers: {
      GET: () =>
        new Response(codexHtml, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    },
  },
});
