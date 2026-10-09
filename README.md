# Energy & Weather Timeline Card

A Home Assistant dashboard card with:

- a clock
- current weather, a weather-warning banner and a red storm alert
- one sliding timeline with now always in the centre, joining yesterday, today and tomorrow: hourly weather, solar production and forecast, home use, grid import/export, battery charge with backup reserve, import and export tariff periods, rain, humidity and UV
- six summary tiles underneath, including the battery's time left and today's import cost and export income

It was built and checked against Home Assistant 2026.10. It is a single file with no external downloads, so it works offline and in the Companion app.

![Card in dark and light themes](images/preview.png)

## Install with HACS

[![Open your Home Assistant instance and open this repository in HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=sencercoltu&repository=energy-weather-timeline-card&category=plugin)

Or add it by hand:

1. Open **HACS → ⋮ → Custom repositories**.
2. Repository: `https://github.com/sencercoltu/energy-weather-timeline-card`. Type: **Dashboard**.
3. Search HACS for **Energy & Weather Timeline Card**, open it and select **Download**.
4. Reload the browser.

HACS registers the dashboard resource for you and offers future releases as updates.

## Install manually

1. Copy `dist/energy-weather-timeline-card.js` to `/config/www/`.
2. Go to **Settings → Dashboards → ⋮ → Resources → Add resource**.
   - URL: `/local/energy-weather-timeline-card.js`
   - Type: **JavaScript module**
3. Hard-refresh the browser.

After either install, edit a dashboard → **Add card** → **Energy & Weather Timeline**.

## Visual editor

Every option is in the card editor, grouped into **Clock and weather**, **Solar**, **Home and grid**, **Battery**, **Tariff and cost** and **Show or hide**. Leave out any entity you don't have, and the parts of the card that need it will hide themselves.

The tariff periods use a small YAML box inside the editor:

```yaml
- start: "00:30"
  end: "05:30"
  rate: 0.075
  type: off_peak
- start: "16:00"
  end: "19:00"
  rate: 0.366
  type: peak
```

`type` is `off_peak`, `standard` or `peak`. Any hour not listed uses **Standard import rate**. Rates are in your currency per kWh, so 0.245 means 24.5p. An optional `label:` replaces the default "off-peak" or "peak" text.

**Export tariff periods** use the same format with your export rates, for example a peak export window:

```yaml
- start: "16:00"
  end: "19:00"
  rate: 0.29
  type: peak
```

Any hour not listed uses **Standard export rate**. When export periods are set, the timeline shows two bands, **Buy** and **Sell**. Leave them out if your export rate is flat; the flat rate is still used for today's income.

**Timeline length** (under **Show or hide**) is 24, 36 or 48 hours, with now always in the centre. The past half comes from your history, reaching back into yesterday; the future half comes from the weather and solar forecasts, reaching into tomorrow. Each midnight is marked with the day's name, and every sunrise and sunset in view is marked at the top.

## What each entity needs

- **Energy sensors** (solar, home, grid import, grid export, rain gauge) are cumulative meters, the same ones the Energy dashboard uses. The card reads their hourly statistics. A sensor without statistics (no `state_class`) is read from the recorder history instead. If an energy sensor is missing, or shows no change today while the matching power sensor shows a flow, the card integrates that power sensor over the day instead; for grid power, positive counts as import and negative as export. The browser console (F12) says which source each flow came from.
- **Battery state of charge, weather and import price** are read from today's recorder history.
- **Weather** must support hourly forecasts. The card subscribes to them, so the forecast hours update live.
- **Solar forecast**: pick a *forecast today* sensor whose attributes hold the hour-by-hour (or half-hourly, 15-minute) forecast, as Solcast and Open-Meteo Solar Forecast do. The card finds the series in the attributes whatever its layout and works out the unit by matching the sensor's daily total. If you leave the entity empty, or it has no such attributes, the card uses the forecast linked to your solar panels in the Energy dashboard. The browser console (F12) shows one line saying which source it used, or why it found none.
- **Power sign conventions**:
  - Grid power: positive = importing.
  - Battery power: positive = discharging. This is the Powerwall/pypowerwall convention.
  - If yours are the other way round, use the invert toggles.
- **Weather warning**: any entity that is `on` (or carries a `warnings` list) while a warning is active, for example a MeteoAlarm binary sensor. The headline, severity colour and start/end times are read from its attributes.

## Example (YAML mode)

The entity IDs below are placeholders; pick yours in the editor.

```yaml
type: custom:energy-weather-timeline-card
weather_entity: weather.home
warning_entity: binary_sensor.meteoalarm
solar_energy_entity: sensor.powerwall_solar_energy
solar_power_entity: sensor.powerwall_solar_power
solar_forecast_tomorrow_entity: sensor.energy_production_tomorrow
home_energy_entity: sensor.powerwall_home_energy
home_power_entity: sensor.powerwall_load_power
grid_import_entity: sensor.powerwall_grid_import
grid_export_entity: sensor.powerwall_grid_export
grid_power_entity: sensor.powerwall_site_power
battery_name: Powerwall
battery_soc_entity: sensor.powerwall_charge
battery_power_entity: sensor.powerwall_battery_power
battery_capacity: 27
battery_reserve: 20
tariff:
  - { start: "00:30", end: "05:30", rate: 0.075, type: off_peak }
  - { start: "16:00", end: "19:00", rate: 0.366, type: peak }
standard_rate: 0.245
export_rate: 0.15
export_tariff:
  - { start: "16:00", end: "19:00", rate: 0.29, type: peak }
timeline_hours: "24"
```

## Good to know

- **Time zone.** The clock and the timeline follow the time zone in your Home Assistant profile, not the device's. You can set a fixed `time_zone` instead.
- **Cost and income are approximate.** Both are worked out per hour, at the rate in force at the middle of each hour. A tariff that changes on a half hour (00:30, 05:30) will be a few pence off your bill. The money tile shows the net amount; it turns green and reads "Today's earnings" when export income is larger than import cost.
- **Self-powered %** is the share of home use not covered directly by grid import in each hour. That's close to how the Tesla app reports it.
- **The running hour** is shown dashed. Its value comes from the live meter reading, so it updates as you watch.
- **Battery time left** needs **Usable battery capacity**. Discharging: time until the backup reserve, and the clock time. Charging: time until full. Idle or full: how long it would last at the current home use. Anything over two days shows as "2+ days".
- **Storm alert.** A red label appears when the hourly forecast for the next 24 hours has thunder, hail or exceptional weather, or gusts of 75 km/h (or a mean wind of 55 km/h) and above. The affected hours are marked red on the timeline. Turn it off with **Storm alert** under **Show or hide**.
- **Light themes** are supported; the card switches its night shading and icon colours automatically.
- **Versions.** The version is shown in the card picker and in the browser console. In the GitHub repo, changing `CARD_VERSION` and pushing publishes a matching release automatically, which HACS then offers as an update.
