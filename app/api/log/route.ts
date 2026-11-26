import { NextResponse } from "next/server";

interface LogPayload {
  userId?: string;
  event?: string;
  category?: string;
  itemName?: string;
  passedCount?: string;
  coins?: number;
  detail?: string;
}

export async function POST(request: Request) {
  try {
    const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const body = (await request.json()) as LogPayload;

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: body.userId || "unknown",
        event: body.event || "unknown",
        category: body.category || "",
        itemName: body.itemName || "",
        passedCount: body.passedCount || "",
        coins: typeof body.coins === "number" ? body.coins : 0,
        detail: body.detail || "",
      }),
      redirect: "follow",
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Google Sheets log error:", error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}