-- #807：回所判斷用，避免掃整張離所表。
CREATE INDEX IF NOT EXISTS v3_dog_departures_name ON v3_dog_departures(name);
