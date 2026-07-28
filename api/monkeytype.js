// /api/monkeytype.js
//
// Serverless function (deploy on Vercel alongside the static site).
// Keeps your Monkeytype Ape Key out of the browser by calling Monkeytype's
// authenticated test-activity endpoint from the server, then handing the
// frontend just the last 30 days in the shape the heatmap expects.
//
// SETUP:
// 1. Generate an Ape Key: monkeytype.com -> account settings -> Ape Keys.
//    (Note: the daily test-activity endpoint this hits is a Monkeytype
//    Premium/Supporter feature. Without Premium, this will return an error
//    and the site will just show "offline" for the Monkeytype block.)
// 2. In your Vercel project: Settings -> Environment Variables -> add
//      MONKEYTYPE_APE_KEY = <your key>
//    Never put the key directly in this file or commit it to git.
// 3. Push this repo to Vercel. No build step needed for a static site;
//    Vercel auto-detects the /api folder as serverless functions.
//
// NOTE ON RESPONSE SHAPE:
// I couldn't directly inspect a live response from
// https://api.monkeytype.com/users/testActivity while building this (it
// requires an authenticated account), so the parsing below is based on
// Monkeytype's public documentation and may need a small tweak. If the
// heatmap shows "offline" after deploying:
//   - Visit https://your-site.vercel.app/api/monkeytype directly in the
//     browser and read the raw JSON it returns (or the error message).
//   - Temporarily add `console.log(JSON.stringify(json))` right after the
//     `const json = await mtRes.json();` line below, redeploy, and check
//     the function logs in your Vercel dashboard to see the real field
//     names, then adjust `testsByDays` / `lastDay` below to match.

export default async function handler(req, res) {
    const apeKey = process.env.MONKEYTYPE_APE_KEY;

    if (!apeKey) {
        res.status(500).json({ error: 'MONKEYTYPE_APE_KEY environment variable is not set' });
        return;
    }

    try {
        const mtRes = await fetch('https://api.monkeytype.com/users/testActivity', {
            headers: { Authorization: `ApeKey ${apeKey}` }
        });

        if (!mtRes.ok) {
            // Common case: account doesn't have Monkeytype Premium, so this
            // endpoint isn't available (403/401), or the key is invalid.
            res.status(mtRes.status).json({
                error: `Monkeytype API returned ${mtRes.status}. This endpoint requires a Monkeytype Premium account.`
            });
            return;
        }

        const json = await mtRes.json();

        // Expected shape (per Monkeytype docs): json.data.testsByDays is an
        // array of daily test counts ending on json.data.lastDay.
        const testsByDays = json?.data?.testsByDays ?? [];
        const lastDay = json?.data?.lastDay ? new Date(json.data.lastDay) : new Date();

        const last30 = testsByDays.slice(-30);
        const days = last30.map((count, i) => {
            const offsetFromEnd = last30.length - 1 - i;
            const d = new Date(lastDay);
            d.setUTCDate(d.getUTCDate() - offsetFromEnd);

            const level = count === 0 ? 0
                : count < 3 ? 1
                : count < 8 ? 2
                : count < 15 ? 3
                : 4;

            return {
                date: d.toISOString().slice(0, 10),
                count,
                level,
                weekday: d.getUTCDay()
            };
        });

        const total = testsByDays.reduce((sum, c) => sum + c, 0);

        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
        res.status(200).json({ days, total });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
