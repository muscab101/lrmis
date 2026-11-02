import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getImpersonation } from "@/lib/server/impersonation";
import { log } from "@/lib/server/log";
import { RECORDINGS_BUCKET, removeExpiredRecordings } from "@/lib/server/recordings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const MAX_BYTES = 5 * 1024 * 1024;
const metaSchema = z.object({
  recording: z.uuid(),
  seq: z.number().int().min(0),
  pages: z.array(z.object({ path: z.string().max(300), at: z.string().max(40) })).max(200),
});

/** The browser sends a piece of the work recording, or just says the person is still here. */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host"))
    return new NextResponse(null, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES)
    return new NextResponse(null, { status: 413 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const form = await request.formData();
  let meta: z.infer<typeof metaSchema>;
  try {
    meta = metaSchema.parse(JSON.parse(String(form.get("meta"))));
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const file = form.get("file");
  let path: string | null = null;
  let bytes = 0;
  if (file instanceof Blob && file.size > 0) {
    path = `${user.id}/${meta.recording}/${meta.seq}.json.gz`;
    bytes = file.size;
    const { error } = await (
      await createAdminClient()
    ).storage
      .from(RECORDINGS_BUCKET)
      .upload(path, await file.arrayBuffer(), { contentType: "application/gzip", upsert: true });
    if (error) {
      log("error", "recording.upload", { error: error.message });
      return new NextResponse(null, { status: 502 });
    }
  }
  const testing = await getImpersonation(user.id);
  const { error } = await supabase.rpc("recording_save", {
    p_recording: meta.recording,
    p_seq: meta.seq,
    p_path: path,
    p_bytes: bytes,
    p_pages: meta.pages,
    p_tested_by: testing?.admin ?? null,
  });
  if (error) return new NextResponse(null, { status: 403 });
  if (Math.random() < 0.02) void removeExpiredRecordings();
  return new NextResponse(null, { status: 204 });
}
