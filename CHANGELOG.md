# Changelog

## v1.8.0
- Summary cells are laid out in rows of three, down to narrow phones (two per row below about 340 px of card). In a narrow card the cells get a little tighter and their small lines wrap instead of being cut off; a number stays with its unit.
- New **Devices** cell across the full width: add each appliance's live power sensor (an EV charger, a heat pump …) with a name under **Devices** in the editor. Each shows its power now and a bar with its share of the home's use right now; the cell's header shows the devices' total. A device below 5 W is faded, and an unavailable sensor shows a dash.

## v1.7.0
- Graph toggles: chips under the graph show or hide **Battery** (the charge line and the reserve line), **Forecast**, **Home**, **Grid** (import) and **Export**. The kWh axis fits what is shown, and the summary tiles are not affected. Each browser remembers its own choice. Turn the chips off with **Graph toggles** under **Show or hide**.
- The Now label no longer shows the time; the clock above already does.
- Sections view: when space is tight, the chips are left out after the tariff bands.

## v1.6.0
- One battery colour scale everywhere: red up to the backup reserve, yellow up to 50 % (was 60 %), green from 80 %, blended in between.
- Battery tile: the total charge bar is now one solid colour from that scale, like each battery's line.
- Graph: the charge line and its shaded area follow the scale by level, the dot at now takes the colour of the current charge, and the reserve line and its label are red.

## v1.5.2
- Battery tile: each battery's line is now one solid colour, the colour the red / yellow / green scale has at that battery's own charge. The total bar keeps the blended scale.

## v1.5.1
- Fixed: just after midnight, a daily energy meter (one that resets to zero each day) read as no energy for the running hour, so grid import showed 0 and self-powered showed 100 %. The running hour now counts from zero after a reset.

## v1.5.0
- Battery tile: optional state of charge for each battery (main first, then expansions), drawn as thin lines with their percentages under the total charge bar. The bar and the lines share one colour scale: red up to the backup reserve, yellow to 60 %, green to 100 %, blended. The reserve mark runs through all of them.
- The Now label is slightly see-through, and a sunrise or sunset close to now moves beside it instead of being hidden.

## v1.4.0
- The kWh axis counts in round steps (0.5, 1, 2, 5, 10 … kWh) instead of odd maxima such as 6996 and 3498, with one grid line per step.
- Hours a home can't produce (over 100 kWh in an hour) are caught: values that are really Wh are divided by 1000, and a lone spike from a meter that dropped to zero and came back is left out. The browser console names the sensor and the hours.
- The import price entity now draws the Buy band, read the same way as the export price entity (rate list, recorded history, current state). A flat standard import rate gets a Buy band too.
- The Now label is back at the top of the graph, outlined with no fill.
- The money tile names each figure once: "Net cost" (or "Net earnings"), then bought and sold in the graph's import and export colours with a bar splitting the two, and the self-powered share.

## v1.3.0
- Fits the sections grid: a default size of 12 columns × 12 rows (minimum 6 × 7), and the card fills whatever rows and columns it is given. The graph grows or shrinks to fit; when space is tight, the humidity row, rain lane, tariff bands, tiles and weather icons are left out, in that order.
- The blue Now label sits on the time axis under the graph instead of at the top.
- Energy totals of 1000 kWh and above show as MWh with two decimals.

## v1.2.0
- Export price entity (optional): the export rate can come from its own entity instead of fixed periods. Past hours use its recorded history; upcoming hours use a rate list in its attributes when it has one (Octopus Energy day-rates events, Nord Pool raw_today / raw_tomorrow). Half-hourly prices are averaged per hour for today's income, and the Sell band shows them at half-hour resolution, coloured by how they compare with the usual rate in view. GBP/kWh, p/kWh and per-MWh units are converted. One console line says what was used.

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
