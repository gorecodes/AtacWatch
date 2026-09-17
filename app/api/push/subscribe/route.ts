import { NextResponse } from "next/server";
import { getSql } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { subscription, stop_id, trip_id, route_short_name, headsign } = body;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json({ error: "subscription non valida" }, { status: 400 });
    }
    if (!stop_id || !trip_id) {
      return NextResponse.json({ error: "stop_id e trip_id obbligatori" }, { status: 400 });
    }

    const sql = getSql();
    await sql`
      INSERT INTO push_subscriptions (endpoint, p256dh, auth, stop_id, trip_id, route_short_name, headsign)
      VALUES (${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth},
              ${stop_id}, ${trip_id}, ${route_short_name ?? null}, ${headsign ?? null})
      ON CONFLICT DO NOTHING
    `;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[push/subscribe POST]", e);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    const { endpoint, stop_id, trip_id } = body;
    if (!endpoint || !stop_id || !trip_id) {
      return NextResponse.json({ error: "parametri mancanti" }, { status: 400 });
    }

    const sql = getSql();
    await sql`
      DELETE FROM push_subscriptions
      WHERE endpoint = ${endpoint} AND stop_id = ${stop_id} AND trip_id = ${trip_id}
    `;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[push/subscribe DELETE]", e);
    return NextResponse.json({ error: "errore interno" }, { status: 500 });
  }
}
