# Auto-trader control channel

The Signal Desk app writes manual commands here (Exit trade, Pause, Resume, Exit all, Allow re-entry).
The auto-trader checks this branch about every 10 seconds during market hours, applies each command
once (by its id) and records the result in `autotrade.json` on the `signals-data` branch.

Paper trading only: no real orders are ever placed.
