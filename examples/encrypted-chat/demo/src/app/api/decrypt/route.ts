// POST /api/decrypt — decrypt a single message using the session key
import { NextRequest, NextResponse } from "next/server";
import { decryptMessage } from "@/lib/service";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const encryptedContent = body.encryptedContent as string;
        const sessionKey = body.sessionKey as string;

        if (!encryptedContent || !sessionKey) {
            return NextResponse.json(
                { error: "encryptedContent and sessionKey are required" },
                { status: 400 },
            );
        }

        const plaintext = decryptMessage(encryptedContent, sessionKey);
        return NextResponse.json({ plaintext });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
