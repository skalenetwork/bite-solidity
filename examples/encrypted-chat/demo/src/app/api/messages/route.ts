// GET /api/messages?offset=0&amount=100 — paginated message fetch
import { NextRequest, NextResponse } from "next/server";
import { getMessages } from "@/lib/service";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = request.nextUrl;
        const offset = Number(searchParams.get("offset") ?? "0");
        const amount = Number(searchParams.get("amount") ?? "100");

        if (isNaN(offset) || isNaN(amount) || offset < 0 || amount < 1) {
            return NextResponse.json({ error: "Invalid offset or amount" }, { status: 400 });
        }

        const result = await getMessages(offset, Math.min(amount, 100));
        return NextResponse.json(result);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
