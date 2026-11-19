import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Speakio web frontend — Next.js 16 on Cloudflare Workers.
// Workers scale to tens of thousands of concurrent users automatically; the
// backend API URL is baked in at build time via NEXT_PUBLIC_API_URL.
export default defineCloudflareConfig();
