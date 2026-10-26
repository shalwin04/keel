import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/** Meta's official Ads MCP (mcp.facebook.com/ads): used for insights and anomaly signals. */
export async function connectAdsMcp(
  url = process.env.META_ADS_MCP_URL ?? "https://mcp.facebook.com/ads",
  token = process.env.META_ADS_MCP_TOKEN ?? "",
) {
  const client = new Client({ name: "keel", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return {
    client,
    call: (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }),
    anomalySignal: (adAccountId: string) => client.callTool({ name: "ads_insights_anomaly_signal", arguments: { ad_account_id: adAccountId } }),
    close: () => client.close(),
  };
}
