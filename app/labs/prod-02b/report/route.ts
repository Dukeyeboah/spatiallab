/** A browser-native attachment download. Reports are neither stored nor logged. */
export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 2_000_000)
    return new Response("Report too large", { status: 413 });
  try {
    const form = await request.formData();
    const raw = form.get("report");
    if (typeof raw !== "string" || raw.length > 1_000_000)
      return new Response("Invalid report", { status: 400 });
    const report = JSON.parse(raw);
    if (
      report.schemaVersion !== 2 ||
      !Array.isArray(report.samples) ||
      report.samples.length > 720
    )
      return new Response("Invalid report format", { status: 400 });
    return new Response(JSON.stringify(report, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="spatial-robot-performance.json"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Invalid report", { status: 400 });
  }
}
