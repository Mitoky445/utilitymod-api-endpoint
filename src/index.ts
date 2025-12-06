interface TrackingPayload {
    license_key: string | null;
    player_uuid: string;
    player_name: string;
    system_username_hash: string;
    system_hardware_hash: string;
}

export interface Env {
    DB: D1Database;
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        // Only allow POST requests for tracking data
        if (request.method !== 'POST') {
            return new Response('Method Not Allowed. Use POST.', { status: 405 });
        }

        try {
            // 1. Parse the request body and cast it to the defined interface
            const trackingData = (await request.json()) as TrackingPayload;

            // 2. Extract fields and provide defaults for optional ones
            const licenseKey = trackingData.license_key || null;
            const playerUUID = trackingData.player_uuid;
            const playerName = trackingData.player_name;
            const systemUsernameHash = trackingData.system_username_hash;
            const systemHardwareHash = trackingData.system_hardware_hash;
            
            // 3. Set the server-side timestamp
            const timestamp = new Date().toISOString();

            // 4. Basic check for required fields
            if (!playerUUID || !playerName || !systemUsernameHash || !systemHardwareHash) {
                return new Response('Missing required fields', { status: 400 });
            }

            // 5. Async Logging (Non-blocking)
            // We use ctx.waitUntil to perform the insert in the background
            // passing the ORIGINAL (non-normalized) data as requested.
            ctx.waitUntil(
                (async () => {
                    try {
                        await env.DB.prepare(
                            `INSERT INTO logs (
                                timestamp,
                                license_key,
                                player_uuid,
                                player_name,
                                system_username_hash,
                                system_hardware_hash
                             ) VALUES (?, ?, ?, ?, ?, ?)`
                        )
                        .bind(
                            timestamp,
                            licenseKey,
                            playerUUID,
                            playerName,
                            systemUsernameHash,
                            systemHardwareHash
                        )
                        .run();
                    } catch (err) {
                        console.error("Failed to log data:", err);
                    }
                })()
            );

            // 6. Caching & Rate Limiting (Light)
            // We use the Cache API to store the blacklist result for 30 seconds.
            // This acts as a light rate limiter by preventing repeated DB hits for the same query.
            const cache = caches.default;
            
            // Create a unique cache key based on the checking parameters.
            // Since we can't cache POST requests easily with the default cache key,
            // we construct a synthetic GET request URL containing the unique identifiers.
            const cacheUrl = new URL(request.url);
            cacheUrl.pathname = "/blacklist-check"; // distinct path for cache
            if (licenseKey) cacheUrl.searchParams.set('license', licenseKey);
            if (playerUUID) cacheUrl.searchParams.set('uuid', playerUUID);
            if (systemHardwareHash) cacheUrl.searchParams.set('hwid', systemHardwareHash);
            // We use a subset of fields that uniquely identify the "user" for banning purposes
            
            const cacheKey = new Request(cacheUrl.toString(), {
                method: 'GET',
            });

            const cachedResponse = await cache.match(cacheKey);
            if (cachedResponse) {
                return cachedResponse;
            }

            // 7. Check Blacklist (Normalized)
            // We normalize inputs to lowercase for comparison, but use SQL 'lower()' 
            // to ensure we match against the DB regardless of how it's stored.
            const checks: string[] = [];
            const args: (string | null)[] = [];

            // Helper to normalize for logic
            const norm = (s: string | null) => s ? s.toLowerCase() : null;

            const nLicenseKey = norm(licenseKey);
            const nPlayerUUID = norm(playerUUID);
            const nPlayerName = norm(playerName);
            const nSystemUsernameHash = norm(systemUsernameHash);
            const nSystemHardwareHash = norm(systemHardwareHash);

            if (nLicenseKey) {
                checks.push("lower(license_key) = ?");
                args.push(nLicenseKey);
            }
            if (nPlayerUUID) {
                checks.push("lower(player_uuid) = ?");
                args.push(nPlayerUUID);
            }
            if (nPlayerName) {
                checks.push("lower(player_name) = ?");
                args.push(nPlayerName);
            }
            if (nSystemUsernameHash) {
                checks.push("lower(system_username_hash) = ?");
                args.push(nSystemUsernameHash);
            }
            if (nSystemHardwareHash) {
                checks.push("lower(system_hardware_hash) = ?");
                args.push(nSystemHardwareHash);
            }

            let blacklistStatus: "system" | "player" | null = null;

            if (checks.length > 0) {
                const query = `SELECT * FROM blacklist WHERE ${checks.join(" OR ")}`;
                const { results } = await env.DB.prepare(query).bind(...args).all();

                if (results && results.length > 0) {
                    for (const row of results) {
                        // Normalize DB values for comparison
                        const rowSysUser = norm(row.system_username_hash as string);
                        const rowSysHw = norm(row.system_hardware_hash as string);
                        const rowUuid = norm(row.player_uuid as string);
                        const rowName = norm(row.player_name as string);
                        const rowLicense = norm(row.license_key as string);

                        // Check for System Ban matches (Priority)
                        if (
                            (nSystemUsernameHash && rowSysUser === nSystemUsernameHash) ||
                            (nSystemHardwareHash && rowSysHw === nSystemHardwareHash)
                        ) {
                            blacklistStatus = "system";
                            break; 
                        }

                        // Check for Player Ban matches
                        if (
                            (nPlayerUUID && rowUuid === nPlayerUUID) ||
                            (nPlayerName && rowName === nPlayerName) ||
                            (nLicenseKey && rowLicense === nLicenseKey)
                        ) {
                            blacklistStatus = "player";
                        }
                    }
                }
            }

            // 8. Construct Response
            const responseData = JSON.stringify({ blacklisted: blacklistStatus });
            const response = new Response(responseData, {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    // Cache-Control header is important for the Cache API to respect the TTL
                    'Cache-Control': 'public, max-age=30', 
                },
            });

            // 9. Save to Cache (Async)
            ctx.waitUntil(cache.put(cacheKey, response.clone()));

            return response;

        } catch (error) {
            console.error(error);
            // Catch parsing errors (e.g., body is not valid JSON)
            return new Response('Invalid request body format.', { status: 400 });
        }
    },
};