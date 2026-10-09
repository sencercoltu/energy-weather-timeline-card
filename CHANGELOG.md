# Changelog

## v1.0.4
- First published GitHub release. Adds the release workflow, which publishes a release whenever the version changes, and the HACS validation workflow.
- No change to how the card works; it is the same as v1.0.3.

## v1.0.3
- Grid import/export, solar and home: a sensor without long-term statistics no longer shows silent zeros; it is read from the recorder history instead.
- Each energy flow falls back to its power sensor (integrated over the day) when the energy sensor is missing or shows no change today, e.g. a lagging smart-meter feed. Grid power alone is now enough for import and export.
- One console line per flow saying where its numbers came from, and a note on the card when a configured flow has no data.

## v1.0.2
- Solar forecast entity: reads today's forecast from any time series in the entity's attributes (lists of `{time, value}`, `[time, value]` pairs or `{time: value}` maps, any interval), and works out the unit by matching the sensor's own daily total.
- Version shown in the card picker and in the browser console line about the forecast source.
- Releases are published automatically when the version changes.

## v1.0.1
- Falls back to the Energy dashboard forecast when the chosen forecast entity has no hourly data.
- Forecast tile explains when there is no hourly forecast.

## v1.0.0
- First release.
