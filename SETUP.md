# SAFEPATH setup

## Requirements

- Node.js 22.13 or later
- Internet access for map tiles, Firestore, and live road-data updates

## Run locally

1. Copy `.env.example` to `.env` if one has not already been created.
2. Set `SAFEPATH_ADMIN_PASSWORD` to a private password with at least 16 characters.
3. Generate a session secret and put the result in `.env`:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

4. Set `FIREBASE_SERVICE_ACCOUNT_BASE64` to the base64-encoded JSON key for the `safepath-vercel` service account. Keep `.env` private; it is ignored by Git.
5. Start SAFEPATH:

   ```powershell
   npm start
   ```

6. Open `http://localhost:3000` for the public map and `http://localhost:3000/admin.html` for the admin dashboard.
7. Sign in with `SAFEPATH_ADMIN_PASSWORD`. The registered Santa Rita Elementary School center appears in Firestore.

On a phone, open the deployed HTTPS address in the browser and tap **Find my location** to grant GPS permission. Location access is requested only after that tap. Browser GPS does not work on a phone when the app is opened over plain HTTP or through `localhost` on another device; use HTTPS for phone testing.

The map includes an OpenStreetMap road snapshot so the map remains available when live road-data services are unavailable. Use **Refresh map data** on the public map to check for newer road data. Live evacuation-center and verified-hazard data come from Firestore; if that service is unavailable, SAFEPATH keeps the road map visible but disables route recommendations until current safety data can be verified. Reports and evacuation centers are stored in Firestore. New reports remain private and pending until approved; admins can reject reports, mark active reports resolved, and manage evacuation centers.

OpenStreetMap data is available under the Open Database License (ODbL). Map attribution is shown on the map. The road snapshot is not a substitute for barangay verification; confirm evacuation-center locations and emergency instructions with local officials before relying on routes.

## Privacy and deployment

Public users do not need an account. Their GPS location remains in their browser unless they intentionally submit a road or area report. Reporter name and phone are optional and are only returned to authenticated admins. Keep `.env` private. Firestore rules deny direct client access; the API uses a dedicated service account with the Firestore user role.

## Deploy to Vercel

The Firebase project `starita-safepath-20261116` uses the Firestore database in `asia-southeast1`. Deploy Firestore rules and indexes with:

```powershell
firebase deploy --only firestore:rules,firestore:indexes --project starita-safepath-20261116
```

In Vercel, add these environment variables for Production and Preview:

- `FIREBASE_SERVICE_ACCOUNT_BASE64`
- `SAFEPATH_ADMIN_PASSWORD`
- `SAFEPATH_SESSION_SECRET`

Use the values from the private local `.env` file. Do not commit or paste service-account keys into chat. Link the GitHub repository to Vercel, then deploy the project. Vercel serves the static map and the `/api/*` serverless function; the function reads and writes Firestore so data persists across deployments.

For use outside a local demonstration, deploy behind HTTPS, restrict admin credentials to trusted staff, and set up database backups and a report-retention policy. Browser geolocation requires HTTPS except on localhost.
