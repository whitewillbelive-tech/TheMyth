import html from "../web/index.html?raw";
export function GET() { return new Response(html, {headers: {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}}); }
