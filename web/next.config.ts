import type { NextConfig } from 'next'

const config: NextConfig = {
  // The dashboard talks to the orchestrator directly (see NEXT_PUBLIC_API_URL).
  // Next's rewrites do not proxy WebSocket upgrades, and the live agent feed is
  // a socket, so proxying here would only work for half the traffic.
  reactStrictMode: true,
}

export default config
