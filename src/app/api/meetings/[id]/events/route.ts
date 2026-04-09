import { getMeeting, ingestTranscriptEvent } from "@/lib/meeting-store";
import { z } from "zod";

const ingestSchema = z.object({
  speakerName: z.string().min(1).max(80),
  text: z.string().min(1).max(2000),
  language: z.string().min(2).max(16).optional(),
  isFinal: z.boolean().optional(),
});

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!getMeeting(id)) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  const payload = await req.json().catch(() => null);
  const parsed = ingestSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await ingestTranscriptEvent(id, parsed.data);
  if (!updated) {
    return Response.json({ error: "Meeting not found" }, { status: 404 });
  }

  return Response.json({
    meeting: updated,
  });
}
