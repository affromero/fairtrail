BEGIN;
-- Serializes startup by multiple application replicas. No historical records
-- are rewritten: an incompatible database fails visibly before serving traffic.
SELECT pg_advisory_xact_lock(761932104);
-- Replace the original checks atomically to admit process-owned previews while
-- retaining strict references and lifecycle rules for every persisted job.
ALTER TABLE "TravelJob" DROP CONSTRAINT IF EXISTS "TravelJob_reference_check";
ALTER TABLE "TravelJob" DROP CONSTRAINT IF EXISTS "TravelJob_lifecycle_check";
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TravelLease_state_check' AND conrelid = '"TravelLease"'::regclass) THEN
    ALTER TABLE "TravelLease" ADD CONSTRAINT "TravelLease_state_check" CHECK (
      state IN ('idle', 'held', 'quarantined') AND generation >= 0 AND "topologyVersion" >= 0
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TravelAdmission_state_check' AND conrelid = '"TravelAdmission"'::regclass) THEN
    ALTER TABLE "TravelAdmission" ADD CONSTRAINT "TravelAdmission_state_check" CHECK (
      id = 'singleton' AND "topologyVersion" >= 0 AND "recoveryGeneration" >= 0 AND
      (NOT "systemWide" OR "vpnEnabled") AND
      (("quarantinedAt" IS NULL AND "quarantineReason" IS NULL) OR
       ("quarantinedAt" IS NOT NULL AND "quarantineReason" IS NOT NULL))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TravelJob_reference_check' AND conrelid = '"TravelJob"'::regclass) THEN
    ALTER TABLE "TravelJob" ADD CONSTRAINT "TravelJob_reference_check" CHECK (
      (kind IN ('flight_batch', 'flight_preview') AND "queryId" IS NULL AND "hotelRunId" IS NULL AND "carRunId" IS NULL) OR
      (kind = 'flight_query' AND "queryId" IS NOT NULL AND "hotelRunId" IS NULL AND "carRunId" IS NULL) OR
      (kind = 'hotel_search' AND "queryId" IS NULL AND "hotelRunId" IS NOT NULL AND "carRunId" IS NULL) OR
      (kind = 'car_search' AND "queryId" IS NULL AND "hotelRunId" IS NULL AND "carRunId" IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TravelJob_lifecycle_check' AND conrelid = '"TravelJob"'::regclass) THEN
    ALTER TABLE "TravelJob" ADD CONSTRAINT "TravelJob_lifecycle_check" CHECK (
      attempts >= 0 AND
      ((status IN ('queued', 'running') AND "activeKey" = CASE kind
        WHEN 'flight_batch' THEN 'flight_batch'
        WHEN 'flight_preview' THEN 'flight_preview:' || id
        WHEN 'flight_query' THEN 'flight_query:' || "queryId"
        WHEN 'hotel_search' THEN 'hotel_search:' || "hotelRunId"
        WHEN 'car_search' THEN 'car_search:' || "carRunId" END AND "activeKey" IS NOT NULL AND "completedAt" IS NULL)
        OR (status IN ('succeeded', 'failed', 'cancelled') AND "activeKey" IS NULL AND "completedAt" IS NOT NULL)) AND
      ((status = 'running' AND "leaseResource" IS NOT NULL AND "leaseOwner" IS NOT NULL AND "leaseGeneration" IS NOT NULL AND "claimedAt" IS NOT NULL AND attempts > 0)
        OR (status <> 'running' AND "leaseResource" IS NULL AND "leaseOwner" IS NULL AND "leaseGeneration" IS NULL)) AND
      ((status = 'cancelled' AND "cancelledAt" IS NOT NULL) OR (status <> 'cancelled' AND "cancelledAt" IS NULL))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TravelAlertDelivery_reference_check' AND conrelid = '"TravelAlertDelivery"'::regclass) THEN
    ALTER TABLE "TravelAlertDelivery" ADD CONSTRAINT "TravelAlertDelivery_reference_check"
      CHECK (num_nonnulls("queryId", "hotelAlertId", "carTrackerId") = 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CarTracker_amounts_check' AND conrelid = '"CarTracker"'::regclass) THEN
    ALTER TABLE "CarTracker" ADD CONSTRAINT "CarTracker_amounts_check" CHECK (
      "targetMinor" BETWEEN 0 AND 9007199254740991 AND
      "historicalLowMinor" BETWEEN 0 AND 9007199254740991 AND
      "latestPriceMinor" BETWEEN 0 AND 9007199254740991 AND
      "scrapeInterval" BETWEEN 1 AND 24 AND revision >= 0
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CarSnapshot_amount_check' AND conrelid = '"CarSnapshot"'::regclass) THEN
    ALTER TABLE "CarSnapshot" ADD CONSTRAINT "CarSnapshot_amount_check"
      CHECK ("totalMinor" BETWEEN 0 AND 9007199254740991 AND (NOT eligible OR "totalMinor" IS NOT NULL));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "CarSearchRun_active_tracker_key"
  ON "CarSearchRun" ("trackerId") WHERE "trackerId" IS NOT NULL AND status IN ('queued', 'running');
CREATE UNIQUE INDEX IF NOT EXISTS "HotelSearchRun_active_tracker_key"
  ON "HotelSearchRun" ("trackerId") WHERE "trackerId" IS NOT NULL AND status IN ('queued', 'running');
COMMIT;
