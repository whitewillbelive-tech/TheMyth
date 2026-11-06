import body from "../../web/app.js?raw";
export function GET() { return new Response(body, {headers: {"Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"}}); }
