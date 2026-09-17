-- Push subscriptions per le notifiche Web Push.
--
-- Una riga = "avvisami quando il bus trip_id arriva alla fermata stop_id".
-- Il worker la consuma (invia la notifica) e poi la cancella.
-- Se il bus non passa mai (corsa cancellata, dati mancanti), la riga
-- viene rimossa automaticamente dopo 2 ore dal cleanup periodico del worker.

CREATE TABLE push_subscriptions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint        text        NOT NULL,
  p256dh          text        NOT NULL,
  auth            text        NOT NULL,
  stop_id         text        NOT NULL,
  trip_id         text        NOT NULL,
  route_short_name text,
  headsign        text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON push_subscriptions (trip_id, stop_id);
CREATE INDEX ON push_subscriptions (created_at);
