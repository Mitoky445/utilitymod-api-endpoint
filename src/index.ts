interface TrackingPayload {
    license_key: string | null;
    player_uuid: string;
    player_name: string;
    system_username: string | null;
    system_hash: string | null;
}

export interface Env {
    DB: D1Database;
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
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
            const systemUsername = trackingData.system_username || null;
            const systemHash = trackingData.system_hash || null;
            
            // 3. Set the server-side timestamp
            const timestamp = new Date().toISOString();

            // 4. Basic check for required fields
            if (!playerUUID || !playerName) {
                return new Response('Missing required fields', { status: 400 });
            }

            // 5. SQL INSERT Statement
            const { success } = await env.DB.prepare(
                `INSERT INTO events (
                    timestamp,
                    license_key,
                    player_uuid,
                    player_name,
                    system_username,
                    system_hash
                 ) VALUES (?, ?, ?, ?, ?, ?)`
            )
            .bind(
                timestamp,
                licenseKey,
                playerUUID,
                playerName,
                systemUsername,
                systemHash
            )
            .run();

            if (!success) {
                return new Response('Failed', { status: 500 });
            }

            // 6. Respond success
            return new Response('Success', {
                status: 202,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                },
            });

        } catch (error) {
            console.error(error);
            // Catch parsing errors (e.g., body is not valid JSON)
            return new Response('Invalid request body format.', { status: 400 });
        }
    },
};