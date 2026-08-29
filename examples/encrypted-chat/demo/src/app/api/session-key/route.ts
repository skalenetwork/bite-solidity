// GET /api/session-key?userId=1 — get the decrypted session private key for a user
import { NextRequest, NextResponse } from "next/server";
import { getSessionKeyForUser } from "@/lib/service";

export async function GET(request: NextRequest) {
    try {
        const userId = Number(request.nextUrl.searchParams.get("userId"));

        if (userId !== 1 && userId !== 2) {
            return NextResponse.json({ error: "userId must be 1 or 2" }, { status: 400 });
        }

        const sessionKey = await getSessionKeyForUser(userId as 1 | 2);
        return NextResponse.json({ sessionKey });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
