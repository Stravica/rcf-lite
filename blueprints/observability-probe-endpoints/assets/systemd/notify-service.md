# systemd Type=notify unit

Reference for a systemd unit consuming the `systemd` profile's `sd_notify` transport. The unit sits on `Type=notify` and delegates the ready-and-watchdog protocol to the process itself.

```ini
[Unit]
Description=<service description>
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
NotifyAccess=main
ExecStart=/usr/local/bin/<service-binary>
Restart=on-failure
WatchdogSec=30s
TimeoutStartSec=60s

[Install]
WantedBy=multi-user.target
```

Notes.

- `Type=notify` blocks systemd's start on the process reaching its ready state; the profile's non-HTTP adapter (TAC-1504) emits `sd_notify(READY=1)` after boot to satisfy that.
- `WatchdogSec=30s` declares the watchdog cadence; the profile's adapter then emits `sd_notify(WATCHDOG=1)` at (at most) that cadence for the process lifetime. A missed cadence causes systemd to terminate and restart the process per the unit's restart policy.
- `NotifyAccess=main` restricts the notify socket to the main process, matching the profile's single-adapter posture.
- No HTTP probe listener is opened for a process running only the `systemd` profile (AC-14105-3 for the analogous `dockerHealthcheck` invariant).

Reference: freedesktop.org/software/systemd/man/sd_notify.html for the notify protocol; freedesktop.org/software/systemd/man/systemd.service.html for the unit-file field reference.
