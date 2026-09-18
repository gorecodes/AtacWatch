/**
 * Delivery delle push notification.
 *
 * Chiamato dopo ogni tick RT: cerca le subscription il cui bus sta arrivando
 * (eta entro i prossimi 5 minuti o già passata da meno di 1 minuto),
 * invia la notifica via Web Push e cancella la riga dal DB.
 *
 * Perché 5 minuti e non 3: il worker gira ogni 60 secondi. Con 3 minuti, un
 * bus a 3:30 dal pick-up salta il tick corrente e la notifica arriva al giro
 * dopo, quando il bus è a 2:30. Con 5 minuti il buffer copre il ciclo del
 * worker più il ritardo di consegna del push, e l'utente ha ancora 4 minuti
 * per muoversi.
 *
 * Le subscription stantie (create più di 2 ore fa, bus mai arrivato o
 * corsa cancellata) vengono ripulite anch'esse a ogni tick.
 */
import type postgres from "postgres";
import webpush from "web-push";

if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
  console.warn("[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY non impostate — notifiche disabilitate");
} else {
  webpush.setVapidDetails(
    "mailto:paolo.pulli@accenture.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

type SubRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  route_short_name: string | null;
  headsign: string | null;
  mins_away: number;
};

export async function deliverPushNotifications(sql: postgres.Sql): Promise<number> {
  if (!process.env.VAPID_PUBLIC_KEY) return 0;

  // Cerca subscription il cui trip è in trip_updates con eta tra -1 e +3 minuti
  const subs = await sql<SubRow[]>`
    SELECT
      ps.id,
      ps.endpoint,
      ps.p256dh,
      ps.auth,
      ps.route_short_name,
      ps.headsign,
      EXTRACT(EPOCH FROM (tu.arrival_ts - now())) / 60 AS mins_away
    FROM push_subscriptions ps
    JOIN trip_updates tu
      ON tu.trip_id = ps.trip_id
     AND tu.stop_id  = ps.stop_id
    WHERE tu.arrival_ts BETWEEN now() - interval '1 minute'
                            AND now() + interval '5 minutes'
  `;

  let sent = 0;
  for (const sub of subs) {
    const mins = Math.max(0, Math.round(sub.mins_away));
    const body = mins === 0
      ? `${sub.headsign ?? ""} — in arrivo`.trim()
      : `${sub.headsign ?? ""} — ${mins} min`.trim();

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({
          title: `${sub.route_short_name ?? "Bus"} in arrivo`,
          body,
          tag: `trip-${sub.id}`,
        }),
      );
      sent++;
    } catch (err) {
      // Subscription scaduta o revocata: la cancelliamo comunque
      console.warn("[push] sendNotification fallita:", (err as Error).message);
    }

    await sql`DELETE FROM push_subscriptions WHERE id = ${sub.id}`;
  }

  // Pulizia subscription stantie (bus già passato o corsa cancellata)
  await sql`DELETE FROM push_subscriptions WHERE created_at < now() - interval '2 hours'`;

  return sent;
}
