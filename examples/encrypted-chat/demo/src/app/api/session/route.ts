// POST /api/session — create a session between the two demo users
import { NextResponse } from "next/server";
import { createSession } from "@/lib/service";

export async function POST() {
    try {
        const txHash = await createSession();
        return NextResponse.json({ txHash });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
