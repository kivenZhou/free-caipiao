/// <reference types="@cloudflare/workers-types" />

interface CloudflareEnv {
  TIPS_KV: KVNamespace;
  ASSETS: Fetcher;
}
