import { env } from "cloudflare:workers";
import { handleApi } from "../../../sites/api.js";
export const dynamic = "force-dynamic";
const handle = (request: Request) => handleApi(request, env);
export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
