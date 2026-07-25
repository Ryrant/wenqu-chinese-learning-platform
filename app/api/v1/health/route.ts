export async function GET() {
  return Response.json({ status: "ok", service: "wenqu-platform", region: "sg", timestamp: new Date().toISOString(), providers: { text: "healthy", speech: "healthy", retrieval: "healthy", moderation: "healthy" } });
}