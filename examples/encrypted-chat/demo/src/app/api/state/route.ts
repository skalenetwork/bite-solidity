// GET /api/state — dashboard state for both users
import { NextResponse } from "next/server";
import { getDashboardState } from "@/lib/service";

export async function GET() {
    try {
        const state = await getDashboardState();
        return NextResponse.json(state);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
