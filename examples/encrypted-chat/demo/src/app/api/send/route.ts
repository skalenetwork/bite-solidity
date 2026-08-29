// POST /api/send — send a message as one of the demo users
import { NextRequest, NextResponse } from "next/server";
import { sendMessage } from "@/lib/service";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const userId = body.userId as number;
        const message = body.message as string;

        if (userId !== 1 && userId !== 2) {
            return NextResponse.json({ error: "userId must be 1 or 2" }, { status: 400 });
        }
        if (!message || typeof message !== "string") {
            return NextResponse.json({ error: "message is required" }, { status: 400 });
        }

        const txHash = await sendMessage(userId as 1 | 2, message);
        return NextResponse.json({ txHash });
    } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
