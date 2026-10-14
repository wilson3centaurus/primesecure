// External discovery has been retired in favour of administrator-uploaded APKs.
export function GET() {
  return Response.json({ error: "The external catalog is no longer available. Upload an APK on the Apps page." }, { status: 410 });
}
