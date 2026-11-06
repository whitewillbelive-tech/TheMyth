import body from "../../web/styles.css?raw";
export function GET() { return new Response(body, {headers: {"Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"}}); }
