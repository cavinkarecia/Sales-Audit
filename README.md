# Sales Audit Ops Platform

A standalone intelligence system for tracking sales auditor attendance, productivity, and geographical spread based on GoSurvey exports.

## Quick Start
1. **Navigate** to this directory: `cd sales-audit-platform`
2. **Install** dependencies: `npm install`
3. **Launch** the dashboard: `npm run dev`
4. **Open** in browser: `http://localhost:5175/`

## Sharing the Dashboard
To share the dashboard with colleagues on your local network:
1. Ensure the dev server is running with the `--host` flag (included in the default command).
2. Share your internal IP address and the port. 
   Example: `http://172.32.8.161:5175/` (This IP will match your corporate network address).

## Key Features
- **Dynamic Attendance Tracking**: Automatically detect weeks and months from uploaded Column B data.
- **Geospatial Audit**: Compare auditor home locations vs. field audit Lat/Long.
- **Cluster Summary**: Real-time audit counts per region (TN, KAR, North, etc.).
- **Absenteeism Analysis**: Breakdown of field force availability and reasons for absence.

## Supported Data Format
- Source: GoSurvey Export (Excel/CSV)
- Column Mapping:
  - B: Date Collected (Used for all time-based aggregations)
  - G: Location (Lat/Long)
  - H: Auditor Name
  - J: Field Attendance Status
  - K: Planned vs. Unplanned status
  - L: Absent Reason
  - V: Area Sales Manager (ASM)
  - AG: Shop Count
