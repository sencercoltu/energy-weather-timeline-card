# Changelog

## v1.1.0
- The timeline slides: now is always in the centre, with 24, 36 or 48 hours in view (Timeline length). Past hours come from history and reach back into yesterday; forecast hours reach into tomorrow, including tomorrow's solar forecast. Each midnight is marked with the day's name and every sunrise and sunset in view is marked.
- Export tariff periods (optional), shown as a second band (Buy / Sell), and export income for today. The money tile shows import cost and export income separately, and the net turns green as "Today's earnings" when income is larger.
- Red storm alert when the next 24 hours of the hourly forecast have thunder, hail, exceptional weather or storm-force wind; the hours are marked on the timeline.
- Battery tile shows the time left: to the reserve when discharging, to full when charging, and at the current home use when idle or full.
- Removed the wind row and the "Today so far" / "Forecast" labels.
- Tariff bands and hourly cost follow local clock time on the days the clocks change.

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
